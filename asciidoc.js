// AsciiDoc parser implementation
const AsciiDoc = {
    parse(text) {
        const lines = text.split('\n');
        const html = [];
        let i = 0;
        
        while (i < lines.length) {
            const line = lines[i];
            const trimmed = line.trim();
            
            // Document title (= Title)
            if (trimmed.startsWith('= ')) {
                html.push(`<h1>${this.escapeHtml(trimmed.substring(2))}</h1>`);
                i++;
                continue;
            }
            
            // Section titles
            if (trimmed.startsWith('==== ')) {
                html.push(`<h4>${this.escapeHtml(trimmed.substring(5))}</h4>`);
                i++;
                continue;
            }
            if (trimmed.startsWith('=== ')) {
                html.push(`<h3>${this.escapeHtml(trimmed.substring(4))}</h3>`);
                i++;
                continue;
            }
            if (trimmed.startsWith('== ')) {
                html.push(`<h2>${this.escapeHtml(trimmed.substring(3))}</h2>`);
                i++;
                continue;
            }
            
            // Unordered lists
            if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
                const listItems = [];
                while (i < lines.length && (lines[i].trim().startsWith('* ') || lines[i].trim().startsWith('- '))) {
                    const item = lines[i].trim().substring(2);
                    listItems.push(`<li>${this.parseInline(item)}</li>`);
                    i++;
                }
                html.push(`<ul>${listItems.join('')}</ul>`);
                continue;
            }
            
            // Ordered lists
            if (/^\d+\.\s/.test(trimmed)) {
                const listItems = [];
                while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
                    const item = lines[i].trim().replace(/^\d+\.\s/, '');
                    listItems.push(`<li>${this.parseInline(item)}</li>`);
                    i++;
                }
                html.push(`<ol>${listItems.join('')}</ol>`);
                continue;
            }
            
            // Code blocks
            if (trimmed.startsWith('----')) {
                const codeLines = [];
                i++;
                while (i < lines.length && !lines[i].trim().startsWith('----')) {
                    codeLines.push(this.escapeHtml(lines[i]));
                    i++;
                }
                i++; // Skip closing ----
                html.push(`<pre><code>${codeLines.join('\n')}</code></pre>`);
                continue;
            }
            
            // Source code blocks with language
            if (trimmed.startsWith('[source')) {
                const langMatch = trimmed.match(/\[source,\s*(\w+)\]/);
                const lang = langMatch ? langMatch[1] : '';
                i++;
                if (lines[i]?.trim().startsWith('----')) {
                    const codeLines = [];
                    i++;
                    while (i < lines.length && !lines[i].trim().startsWith('----')) {
                        codeLines.push(this.escapeHtml(lines[i]));
                        i++;
                    }
                    i++; // Skip closing ----
                    html.push(`<pre><code class="language-${lang}">${codeLines.join('\n')}</code></pre>`);
                }
                continue;
            }
            
            // Blockquotes
            if (trimmed.startsWith('____')) {
                const quoteLines = [];
                i++;
                while (i < lines.length && !lines[i].trim().startsWith('____')) {
                    if (lines[i].trim()) {
                        quoteLines.push(this.parseInline(lines[i]));
                    }
                    i++;
                }
                i++; // Skip closing ____
                html.push(`<blockquote>${quoteLines.join('<br>')}</blockquote>`);
                continue;
            }
            
            // Sidebar blocks
            if (trimmed.startsWith('****')) {
                const sidebarLines = [];
                i++;
                while (i < lines.length && !lines[i].trim().startsWith('****')) {
                    if (lines[i].trim()) {
                        sidebarLines.push(this.parseInline(lines[i]));
                    }
                    i++;
                }
                i++; // Skip closing ****
                html.push(`<div class="sidebar">${sidebarLines.join('<br>')}</div>`);
                continue;
            }
            
            // Admonitions
            const admonitionMatch = trimmed.match(/^(NOTE|TIP|IMPORTANT|WARNING|CAUTION):\s*(.+)$/);
            if (admonitionMatch) {
                const [, type, content] = admonitionMatch;
                html.push(`<div class="admonition admonition-${type.toLowerCase()}"><strong>${type}:</strong> ${this.parseInline(content)}</div>`);
                i++;
                continue;
            }
            
            // Horizontal rule
            if (trimmed === "'''") {
                html.push('<hr>');
                i++;
                continue;
            }
            
            // Tables (simple format)
            if (trimmed.startsWith('|===')) {
                const tableRows = [];
                i++;
                while (i < lines.length && !lines[i].trim().startsWith('|===')) {
                    const row = lines[i].trim();
                    if (row) {
                        const cells = row.split('|').filter(c => c.trim());
                        const cellsHtml = cells.map(c => `<td>${this.parseInline(c.trim())}</td>`).join('');
                        tableRows.push(`<tr>${cellsHtml}</tr>`);
                    }
                    i++;
                }
                i++; // Skip closing |===
                html.push(`<table><tbody>${tableRows.join('')}</tbody></table>`);
                continue;
            }
            
            // Empty line
            if (trimmed === '') {
                i++;
                continue;
            }
            
            // Regular paragraph
            const paragraphLines = [];
            while (i < lines.length && lines[i].trim() !== '' && !this.isBlockElement(lines[i])) {
                paragraphLines.push(lines[i]);
                i++;
            }
            if (paragraphLines.length > 0) {
                html.push(`<p>${this.parseInline(paragraphLines.join(' '))}</p>`);
            }
        }
        
        return html.join('\n');
    },
    
    isBlockElement(line) {
        const trimmed = line.trim();
        return trimmed.startsWith('=') ||
               trimmed.startsWith('* ') ||
               trimmed.startsWith('- ') ||
               /^\d+\.\s/.test(trimmed) ||
               trimmed.startsWith('----') ||
               trimmed.startsWith('[source') ||
               trimmed.startsWith('____') ||
               trimmed.startsWith('****') ||
               trimmed.startsWith('|===') ||
               trimmed === "'''" ||
               /^(NOTE|TIP|IMPORTANT|WARNING|CAUTION):/.test(trimmed);
    },
    
    parseInline(text) {
        let result = text;
        
        // Images FIRST (before escaping): image::path[] or image:path[]
        result = result.replace(/image::([^\[]+)\[([^\]]*)\]/g, (match, path, alt) => {
            return `<img src="${path.trim()}" alt="${alt}" style="max-width: 100%; height: auto;">`;
        });
        result = result.replace(/image:([^\[]+)\[([^\]]*)\]/g, (match, path, alt) => {
            return `<img src="${path.trim()}" alt="${alt}" style="max-width: 100%; height: auto; display: inline-block;">`;
        });
        
        // Wikilinks SECOND (before escaping): [[Target Page]] or [[target page|display text]]
        result = result.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (match, target, display) => {
            const normalizedTarget = this.normalizeWikilink(target);
            return `<a href="#" class="wikilink" data-target="${normalizedTarget}" onclick="app.searchWikilink('${normalizedTarget}'); return false;">${display}</a>`;
        });
        result = result.replace(/\[\[([^\]]+)\]\]/g, (match, target) => {
            const normalizedTarget = this.normalizeWikilink(target.trim());
            return `<a href="#" class="wikilink" data-target="${normalizedTarget}" onclick="app.searchWikilink('${normalizedTarget}'); return false;">${target.trim()}</a>`;
        });
        
        // Nostr links (before escaping): nostr:npub..., nostr:note..., nostr:nevent...
        result = result.replace(/nostr:(npub|note|nevent|nprofile|naddr)[a-z0-9]+/gi, (match) => {
            return `<a href="#" class="nostr-link" onclick="app.openNostrLink('${match}'); return false;">${match}</a>`;
        });
        
        // Regular links (before escaping): https://example.com[Link Text] or just https://example.com
        result = result.replace(/(https?:\/\/[^\s\[]+)\[([^\]]+)\]/g, (match, url, linkText) => {
            return `<a href="${url}" target="_blank">${linkText}</a>`;
        });
        
        // NOW escape HTML
        result = this.escapeHtml(result);
        
        // Auto-link bare URLs (after escaping)
        result = result.replace(/(https?:\/\/[^\s<]+)/g, (match) => {
            // Don't double-link if already in an anchor tag
            if (match.includes('&lt;a ') || match.includes('&lt;img')) return match;
            return `<a href="${match}" target="_blank">${match}</a>`;
        });
        
        // Cross references: <<anchor,text>> or <<anchor>>
        result = result.replace(/&lt;&lt;([^,&]+),([^&]+)&gt;&gt;/g, (match, anchor, linkText) => {
            return `<a href="#${anchor}">${linkText}</a>`;
        });
        result = result.replace(/&lt;&lt;([^&]+)&gt;&gt;/g, (match, anchor) => {
            return `<a href="#${anchor}">${anchor}</a>`;
        });
        
        // Strong (bold): *text* or **text**
        result = result.replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>');
        result = result.replace(/\*([^\*]+)\*/g, '<strong>$1</strong>');
        
        // Emphasis (italic): _text_ or __text__
        result = result.replace(/__([^_]+)__/g, '<em>$1</em>');
        result = result.replace(/_([^_]+)_/g, '<em>$1</em>');
        
        // Monospace: `text` or ``text``
        result = result.replace(/``([^`]+)``/g, '<code>$1</code>');
        result = result.replace(/`([^`]+)`/g, '<code>$1</code>');
        
        // Superscript: ^text^
        result = result.replace(/\^([^\^]+)\^/g, '<sup>$1</sup>');
        
        // Subscript: ~text~
        result = result.replace(/~([^~]+)~/g, '<sub>$1</sub>');
        
        // Line breaks: + at end of line
        result = result.replace(/\s\+$/g, '<br>');
        
        return result;
    },
    
    normalizeWikilink(text) {
        // NIP-54 normalization: lowercase, non-letters become dashes
        return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    },
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};