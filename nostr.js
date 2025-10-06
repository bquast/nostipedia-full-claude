// Nostr protocol implementation
const Nostr = {
    relays: {},
    subscriptions: {},
    eventHandlers: [],

    async connect(relayUrls) {
        const promises = relayUrls.map(url => this.connectRelay(url));
        await Promise.allSettled(promises);
    },

    async connectRelay(url) {
        return new Promise((resolve, reject) => {
            if (this.relays[url]?.readyState === WebSocket.OPEN) {
                resolve(this.relays[url]);
                return;
            }

            const ws = new WebSocket(url);
            
            ws.onopen = () => {
                console.log('Connected to', url);
                this.relays[url] = ws;
                resolve(ws);
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleMessage(url, data);
                } catch (err) {
                    console.error('Failed to parse message:', err);
                }
            };

            ws.onerror = (error) => {
                console.error('WebSocket error:', url, error);
                reject(error);
            };

            ws.onclose = () => {
                console.log('Disconnected from', url);
                delete this.relays[url];
            };

            setTimeout(() => reject(new Error('Connection timeout')), 5000);
        });
    },

    handleMessage(relayUrl, data) {
        const [type, ...rest] = data;

        switch (type) {
            case 'EVENT':
                const [subId, event] = rest;
                this.eventHandlers.forEach(handler => handler(event, relayUrl));
                break;
            
            case 'EOSE':
                console.log('End of stored events for subscription:', rest[0]);
                break;
            
            case 'OK':
                const [eventId, success, message] = rest;
                console.log('Event publish result:', eventId, success, message);
                break;
            
            case 'NOTICE':
                console.log('Relay notice:', rest[0]);
                break;
        }
    },

    subscribe(filters, onEvent) {
        const subId = 'sub_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        this.subscriptions[subId] = { filters, onEvent };
        
        if (onEvent) {
            this.eventHandlers.push((event, relay) => {
                if (this.matchesFilters(event, filters)) {
                    onEvent(event, relay);
                }
            });
        }

        Object.values(this.relays).forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(['REQ', subId, filters]));
            }
        });

        return subId;
    },

    unsubscribe(subId) {
        delete this.subscriptions[subId];
        
        Object.values(this.relays).forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(['CLOSE', subId]));
            }
        });
    },

    matchesFilters(event, filters) {
        if (filters.ids && !filters.ids.includes(event.id)) return false;
        if (filters.authors && !filters.authors.includes(event.pubkey)) return false;
        if (filters.kinds && !filters.kinds.includes(event.kind)) return false;
        if (filters.since && event.created_at < filters.since) return false;
        if (filters.until && event.created_at > filters.until) return false;

        // Check tag filters
        for (const [key, values] of Object.entries(filters)) {
            if (key.startsWith('#')) {
                const tagName = key.substring(1);
                const eventTags = event.tags
                    .filter(t => t[0] === tagName)
                    .map(t => t[1]);
                
                if (!values.some(v => eventTags.includes(v))) {
                    return false;
                }
            }
        }

        return true;
    },

    async publish(event) {
        const results = {};
        const promises = [];

        Object.entries(this.relays).forEach(([url, ws]) => {
            if (ws.readyState === WebSocket.OPEN) {
                promises.push(
                    new Promise((resolve) => {
                        ws.send(JSON.stringify(['EVENT', event]));
                        results[url] = 'sent';
                        resolve();
                    })
                );
            } else {
                results[url] = 'disconnected';
            }
        });

        await Promise.all(promises);
        return results;
    },

    async createEvent(kind, content, tags = [], privateKey) {
        const pubkey = Crypto.getPublicKey(privateKey);
        const created_at = Math.floor(Date.now() / 1000);

        const event = {
            kind,
            created_at,
            tags,
            content,
            pubkey
        };

        // Create event ID
        const serialized = JSON.stringify([
            0,
            event.pubkey,
            event.created_at,
            event.kind,
            event.tags,
            event.content
        ]);

        const id = await Crypto.sha256Hex(serialized);
        event.id = id;

        // Sign event
        event.sig = await Crypto.sign(privateKey, id);

        return event;
    },

    getConnectedRelays() {
        return Object.entries(this.relays)
            .filter(([_, ws]) => ws.readyState === WebSocket.OPEN)
            .map(([url]) => url);
    },

    disconnect() {
        Object.values(this.relays).forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
        });
        this.relays = {};
        this.subscriptions = {};
        this.eventHandlers = [];
    }
};