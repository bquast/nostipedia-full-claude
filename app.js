// Main application logic
const app = {
    privateKey: null,
    publicKey: null,
    relayUrls: [],
    compareMode: false,
    articles: {},
    currentSearch: null,

    init() {
        this.loadSettings();
        this.connectToRelays();
        this.updateConnectionStatus();
        
        // Update connection status periodically
        setInterval(() => this.updateConnectionStatus(), 3000);
    },

    loadSettings() {
        const stored = localStorage.getItem('nostipedia_settings');
        if (stored) {
            try {
                const settings = JSON.parse(stored);
                this.privateKey = settings.privateKey;
                this.publicKey = settings.publicKey;
                this.relayUrls = settings.relays || this.getDefaultRelays();
            } catch (err) {
                console.error('Failed to load settings:', err);
                this.relayUrls = this.getDefaultRelays();
            }
        } else {
            this.relayUrls = this.getDefaultRelays();
        }
    },

    getDefaultRelays() {
        return [
            'wss://relay.damus.io',
            'wss://relay.nostr.band',
            'wss://nos.lol',
            'wss://relay.snort.social'
        ];
    },

    async connectToRelays() {
        try {
            await Nostr.connect(this.relayUrls);
            this.updateConnectionStatus();
        } catch (err) {
            console.error('Failed to connect to relays:', err);
        }
    },

    updateConnectionStatus() {
        const connected = Nostr.getConnectedRelays();
        const indicator = document.getElementById('statusIndicator');
        
        if (connected.length > 0) {
            indicator.className = 'status-indicator connected';
            indicator.textContent = `Connected (${connected.length})`;
        } else {
            indicator.className = 'status-indicator disconnected';
            indicator.textContent = 'Disconnected';
        }
    },

    async search() {
        const query = document.getElementById('searchInput').value.trim();
        if (!query) return;

        this.currentSearch = query;
        this.showLoading('article1');

        // Clear previous articles
        this.articles[query] = [];

        // Subscribe to wiki articles with this title
        const filter = {
            kinds: [30818],
            '#d': [query],
            limit: 100
        };

        Nostr.subscribe(filter, (event) => {
            this.processArticle(event);
            
            // Update display if this is still the current search
            if (this.currentSearch === query) {
                this.displayArticle(query, 'article1');
            }
        });

        // Give relays time to respond
        setTimeout(() => {
            if (this.currentSearch === query) {
                this.displayArticle(query, 'article1');
            }
        }, 2000);
    },

    processArticle(event) {
        const title = event.tags.find(t => t[0] === 'd')?.[1];
        if (!title) return;

        const summary = event.tags.find(t => t[0] === 'summary')?.[1] || '';
        const publishedAt = event.tags.find(t => t[0] === 'published_at')?.[1];

        if (!this.articles[title]) {
            this.articles[title] = [];
        }

        // Check if we already have this event
        const exists = this.articles[title].some(a => a.id === event.id);
        if (exists) return;

        this.articles[title].push({
            id: event.id,
            content: event.content,
            summary: summary,
            author: event.pubkey,
            created: event.created_at,
            publishedAt: publishedAt ? parseInt(publishedAt) : event.created_at,
            tags: event.tags
        });

        // Sort by creation time, newest first
        this.articles[title].sort((a, b) => b.created - a.created);
    },

    displayArticle(title, panelId) {
        const panel = document.getElementById(panelId);
        const versions = this.articles[title];

        if (!versions || versions.length === 0) {
            panel.innerHTML = `
                <div class="empty-state">
                    <h2>Article not found</h2>
                    <p>No versions of "${this.escapeHtml(title)}" found on the relays</p>
                    <button class="btn" onclick="app.showCreateModal('${this.escapeHtml(title)}')">Create it</button>
                </div>
            `;
            return;
        }

        const latest = versions[0];
        const content = this.parseMarkdown(latest.content);

        let versionSelector = '';
        if (versions.length > 1) {
            versionSelector = `
                <select class="version-selector" onchange="app.switchVersion('${this.escapeHtml(title)}', this.value, '${panelId}')">
                    ${versions.map((v, i) => `
                        <option value="${i}">
                            ${this.formatDate(v.created)} by ${v.author.substring(0, 8)}...
                            ${v.summary ? '- ' + this.escapeHtml(v.summary.substring(0, 30)) : ''}
                        </option>
                    `).join('')}
                </select>
            `;
        }

        panel.innerHTML = `
            <div class="article-header">
                <h1 class="article-title">${this.escapeHtml(title)}</h1>
                ${versionSelector}
            </div>
            <div class="article-meta">
                ${this.escapeHtml(latest.summary || 'No summary')} • 
                ${this.formatDate(latest.created)} • 
                Author: ${latest.author.substring(0, 8)}...
            </div>
            <div class="article-content">
                ${content}
            </div>
        `;
    },

    switchVersion(title, versionIndex, panelId) {
        const panel = document.getElementById(panelId);
        const version = this.articles[title][parseInt(versionIndex)];
        const content = this.parseMarkdown(version.content);

        const contentDiv = panel.querySelector('.article-content');
        const metaDiv = panel.querySelector('.article-meta');

        contentDiv.innerHTML = content;
        metaDiv.innerHTML = `
            ${this.escapeHtml(version.summary || 'No summary')} • 
            ${this.formatDate(version.created)} • 
            Author: ${version.author.substring(0, 8)}...
        `;
    },

    parseMarkdown(md) {
        let html = this.escapeHtml(md);
        
        // Headers
        html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
        html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
        html = html.replace(/^# (.*$)/gim, '<h2>$1</h2>');
        
        // Bold
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/__(.*?)__/g, '<strong>$1</strong>');
        
        // Italic
        html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
        html = html.replace(/_(.*?)_/g, '<em>$1</em>');
        
        // Links
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
        
        // Line breaks and paragraphs
        const lines = html.split('\n');
        const processed = [];
        let inParagraph = false;

        for (let line of lines) {
            line = line.trim();
            
            if (line === '') {
                if (inParagraph) {
                    processed.push('</p>');
                    inParagraph = false;
                }
            } else if (line.startsWith('<h')) {
                if (inParagraph) {
                    processed.push('</p>');
                    inParagraph = false;
                }
                processed.push(line);
            } else {
                if (!inParagraph) {
                    processed.push('<p>');
                    inParagraph = true;
                } else {
                    processed.push('<br>');
                }
                processed.push(line);
            }
        }

        if (inParagraph) {
            processed.push('</p>');
        }

        return processed.join('\n');
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    formatDate(timestamp) {
        const date = new Date(timestamp * 1000);
        return date.toLocaleString();
    },

    async publishArticle() {
        if (!this.privateKey) {
            alert('Please set your private key in settings first');
            this.showSettingsModal();
            return;
        }

        const title = document.getElementById('articleTitleInput').value.trim();
        const content = document.getElementById('articleContentInput').value.trim();
        const summary = document.getElementById('articleSummaryInput').value.trim();

        if (!title || !content) {
            alert('Title and content are required');
            return;
        }

        try {
            const tags = [
                ['d', title],
                ['title', title],
                ['published_at', Math.floor(Date.now() / 1000).toString()]
            ];

            if (summary) {
                tags.push(['summary', summary]);
            }

            const event = await Nostr.createEvent(30818, content, tags, this.privateKey);
            
            const results = await Nostr.publish(event);
            console.log('Publish results:', results);

            this.closeCreateModal();
            alert('Article published! Searching for it now...');

            // Search for the article
            document.getElementById('searchInput').value = title;
            setTimeout(() => this.search(), 1000);

        } catch (err) {
            console.error('Failed to publish:', err);
            alert('Failed to publish article: ' + err.message);
        }
    },

    toggleCompare() {
        this.compareMode = !this.compareMode;
        const container = document.getElementById('articlesContainer');
        const article1 = document.getElementById('article1');
        const btn = document.getElementById('compareBtn');

        if (this.compareMode) {
            article1.classList.remove('single');
            
            if (!document.getElementById('article2')) {
                const article2 = document.createElement('div');
                article2.id = 'article2';
                article2.className = 'article-panel';
                article2.innerHTML = `
                    <div class="empty-state">
                        <h2>Select a version to compare</h2>
                        <p>This panel will show a different version</p>
                    </div>
                `;
                container.appendChild(article2);
            }

            // If we have a current search, show it in both panels
            if (this.currentSearch && this.articles[this.currentSearch]?.length > 1) {
                this.displayArticle(this.currentSearch, 'article2');
            }
            
            btn.textContent = 'Single View';
        } else {
            article1.classList.add('single');
            const article2 = document.getElementById('article2');
            if (article2) article2.remove();
            btn.textContent = 'Compare';
        }
    },

    showLoading(panelId = 'article1') {
        const panel = document.getElementById(panelId);
        panel.innerHTML = '<div class="loading">Loading article...</div>';
    },

    showHome() {
        const panel = document.getElementById('article1');
        panel.classList.add('single');
        panel.innerHTML = `
            <div class="empty-state">
                <h2>Welcome to Nostipedia</h2>
                <p>A decentralized wiki powered by Nostr</p>
                <p>Search for an article above or create a new one</p>
            </div>
        `;
        
        if (this.compareMode) {
            this.toggleCompare();
        }

        this.currentSearch = null;
    },

    showSettingsModal() {
        const modal = document.getElementById('settingsModal');
        
        if (this.privateKey) {
            const nsec = Bech32.encodePrivkey(this.privateKey);
            document.getElementById('privKeyInput').value = nsec;
        } else {
            document.getElementById('privKeyInput').value = '';
        }

        if (this.publicKey) {
            const npub = Bech32.encodePubkey(this.publicKey);
            document.getElementById('pubKeyDisplay').value = npub;
        } else {
            document.getElementById('pubKeyDisplay').value = 'No key set';
        }

        document.getElementById('relayInput').value = this.relayUrls.join('\n');
        modal.classList.add('active');
    },

    closeSettingsModal() {
        document.getElementById('settingsModal').classList.remove('active');
    },

    async generateKey() {
        const privKey = Crypto.generatePrivateKey();
        const pubKey = Crypto.getPublicKey(privKey);
        
        this.privateKey = privKey;
        this.publicKey = pubKey;

        const nsec = Bech32.encodePrivkey(privKey);
        const npub = Bech32.encodePubkey(pubKey);

        document.getElementById('privKeyInput').value = nsec;
        document.getElementById('pubKeyDisplay').value = npub;

        alert('New key pair generated! Make sure to save your private key (nsec).');
    },

    saveSettings() {
        const privKeyInput = document.getElementById('privKeyInput').value.trim();
        const relayText = document.getElementById('relayInput').value;
        
        if (privKeyInput) {
            try {
                // Decode if it's bech32
                if (privKeyInput.startsWith('nsec1')) {
                    this.privateKey = Bech32.decodePrivkey(privKeyInput);
                } else {
                    this.privateKey = privKeyInput;
                }
                
                this.publicKey = Crypto.getPublicKey(this.privateKey);
                
                const npub = Bech32.encodePubkey(this.publicKey);
                document.getElementById('pubKeyDisplay').value = npub;
            } catch (err) {
                alert('Invalid private key format');
                return;
            }
        }

        this.relayUrls = relayText.split('\n')
            .map(r => r.trim())
            .filter(r => r.startsWith('wss://') || r.startsWith('ws://'));

        if (this.relayUrls.length === 0) {
            alert('Please add at least one relay URL');
            return;
        }

        const settings = {
            privateKey: this.privateKey,
            publicKey: this.publicKey,
            relays: this.relayUrls
        };

        localStorage.setItem('nostipedia_settings', JSON.stringify(settings));
        
        this.closeSettingsModal();
        
        // Reconnect to relays
        Nostr.disconnect();
        this.connectToRelays();
        
        alert('Settings saved!');
    },

    showCreateModal(title = '') {
        const modal = document.getElementById('createModal');
        document.getElementById('articleTitleInput').value = title;
        document.getElementById('articleContentInput').value = '';
        document.getElementById('articleSummaryInput').value = '';
        modal.classList.add('active');
    },

    closeCreateModal() {
        document.getElementById('createModal').classList.remove('active');
    }
};

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => app.init());
} else {
    app.init();
}