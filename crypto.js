// secp256k1 implementation for Nostr
const Crypto = {
    // secp256k1 curve parameters
    P: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2Fn,
    N: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n,
    Gx: 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n,
    Gy: 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n,

    mod(a, b = this.P) {
        const result = a % b;
        return result >= 0n ? result : b + result;
    },

    powMod(base, exponent, modulus) {
        if (modulus === 1n) return 0n;
        let result = 1n;
        base = this.mod(base, modulus);
        while (exponent > 0n) {
            if (exponent % 2n === 1n) {
                result = this.mod(result * base, modulus);
            }
            exponent = exponent >> 1n;
            base = this.mod(base * base, modulus);
        }
        return result;
    },

    modInverse(a, m = this.P) {
        a = this.mod(a, m);
        if (a === 0n) return 0n;
        let [lm, hm] = [1n, 0n];
        let [low, high] = [this.mod(a, m), m];
        while (low > 1n) {
            const r = high / low;
            const nm = hm - lm * r;
            const nw = high - low * r;
            [hm, lm, high, low] = [lm, nm, low, nw];
        }
        return this.mod(lm, m);
    },

    pointAdd(p1, p2) {
        if (!p1) return p2;
        if (!p2) return p1;
        
        const [x1, y1] = p1;
        const [x2, y2] = p2;

        if (x1 === x2 && y1 === y2) {
            const s = this.mod(
                this.mod(3n * x1 * x1) * this.modInverse(2n * y1)
            );
            const x3 = this.mod(s * s - 2n * x1);
            const y3 = this.mod(s * (x1 - x3) - y1);
            return [x3, y3];
        }

        if (x1 === x2) return null;

        const s = this.mod(
            this.mod(y2 - y1) * this.modInverse(this.mod(x2 - x1))
        );
        const x3 = this.mod(s * s - x1 - x2);
        const y3 = this.mod(s * (x1 - x3) - y1);
        return [x3, y3];
    },

    pointMultiply(k, p = [this.Gx, this.Gy]) {
        let result = null;
        let addend = p;

        while (k > 0n) {
            if (k & 1n) {
                result = this.pointAdd(result, addend);
            }
            addend = this.pointAdd(addend, addend);
            k >>= 1n;
        }

        return result;
    },

    getPublicKey(privateKey) {
        const privBigInt = typeof privateKey === 'string' 
            ? BigInt('0x' + privateKey) 
            : privateKey;
        
        const point = this.pointMultiply(privBigInt);
        return this.bytesToHex(this.encodePoint(point));
    },

    encodePoint(point) {
        if (!point) return new Uint8Array(33);
        const [x, y] = point;
        const xBytes = this.bigIntToBytes(x, 32);
        const prefix = (y & 1n) === 0n ? 0x02 : 0x03;
        return new Uint8Array([prefix, ...xBytes]);
    },

    bigIntToBytes(num, length) {
        const hex = num.toString(16).padStart(length * 2, '0');
        return this.hexToBytes(hex);
    },

    bytesToBigInt(bytes) {
        return BigInt('0x' + this.bytesToHex(bytes));
    },

    async sha256(data) {
        const buffer = typeof data === 'string' 
            ? new TextEncoder().encode(data) 
            : data;
        const hash = await crypto.subtle.digest('SHA-256', buffer);
        return new Uint8Array(hash);
    },

    async sha256Hex(data) {
        const hash = await this.sha256(data);
        return this.bytesToHex(hash);
    },

    bytesToHex(bytes) {
        return Array.from(bytes)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    },

    hexToBytes(hex) {
        if (hex.length % 2) hex = '0' + hex;
        const bytes = [];
        for (let i = 0; i < hex.length; i += 2) {
            bytes.push(parseInt(hex.substr(i, 2), 16));
        }
        return new Uint8Array(bytes);
    },

    async sign(privateKey, messageHash) {
        const privKey = typeof privateKey === 'string' 
            ? BigInt('0x' + privateKey) 
            : privateKey;
        
        const msgHash = typeof messageHash === 'string'
            ? BigInt('0x' + messageHash)
            : this.bytesToBigInt(messageHash);

        // RFC6979 deterministic k generation (simplified)
        const k = await this.generateK(privKey, msgHash);
        
        // R = k * G
        const R = this.pointMultiply(k);
        const r = R[0] % this.N;
        
        if (r === 0n) throw new Error('Invalid r');

        // s = k^-1 * (msgHash + r * privKey) mod N
        const kInv = this.modInverse(k, this.N);
        const s = this.mod((msgHash + r * privKey) * kInv, this.N);
        
        if (s === 0n) throw new Error('Invalid s');

        // Schnorr requires different format - using simple ECDSA for now
        // In production Nostr, use proper Schnorr (BIP340)
        const rHex = r.toString(16).padStart(64, '0');
        const sHex = s.toString(16).padStart(64, '0');
        
        return rHex + sHex;
    },

    async generateK(privKey, msgHash) {
        // Simplified deterministic k (not full RFC6979, but deterministic)
        const combined = privKey.toString(16) + msgHash.toString(16);
        const hash = await this.sha256(combined);
        let k = this.bytesToBigInt(hash);
        k = this.mod(k, this.N);
        if (k === 0n) k = 1n;
        return k;
    },

    generatePrivateKey() {
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        let key = this.bytesToBigInt(bytes);
        
        // Ensure key is within valid range
        while (key >= this.N || key === 0n) {
            crypto.getRandomValues(bytes);
            key = this.bytesToBigInt(bytes);
        }
        
        return this.bytesToHex(this.bigIntToBytes(key, 32));
    }
};

// Bech32 encoding/decoding for Nostr keys
const Bech32 = {
    charset: 'qpzry9x8gf2tvdw0s3jn54khce6mua7l',

    polymod(values) {
        const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
        let chk = 1;
        for (const value of values) {
            const top = chk >> 25;
            chk = ((chk & 0x1ffffff) << 5) ^ value;
            for (let i = 0; i < 5; i++) {
                if ((top >> i) & 1) {
                    chk ^= GEN[i];
                }
            }
        }
        return chk;
    },

    hrpExpand(hrp) {
        const arr = [];
        for (let i = 0; i < hrp.length; i++) {
            arr.push(hrp.charCodeAt(i) >> 5);
        }
        arr.push(0);
        for (let i = 0; i < hrp.length; i++) {
            arr.push(hrp.charCodeAt(i) & 31);
        }
        return arr;
    },

    createChecksum(hrp, data) {
        const values = this.hrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
        const mod = this.polymod(values) ^ 1;
        const ret = [];
        for (let i = 0; i < 6; i++) {
            ret.push((mod >> (5 * (5 - i))) & 31);
        }
        return ret;
    },

    encode(hrp, data) {
        const combined = data.concat(this.createChecksum(hrp, data));
        let result = hrp + '1';
        for (const d of combined) {
            result += this.charset[d];
        }
        return result;
    },

    decode(bechString) {
        const pos = bechString.lastIndexOf('1');
        if (pos < 1 || pos + 7 > bechString.length) {
            throw new Error('Invalid bech32 string');
        }

        const hrp = bechString.substring(0, pos);
        const data = [];

        for (let i = pos + 1; i < bechString.length; i++) {
            const d = this.charset.indexOf(bechString[i]);
            if (d === -1) throw new Error('Invalid bech32 character');
            data.push(d);
        }

        if (!this.verifyChecksum(hrp, data)) {
            throw new Error('Invalid bech32 checksum');
        }

        return { hrp, data: data.slice(0, -6) };
    },

    verifyChecksum(hrp, data) {
        return this.polymod(this.hrpExpand(hrp).concat(data)) === 1;
    },

    convertBits(data, fromBits, toBits, pad = true) {
        let acc = 0;
        let bits = 0;
        const ret = [];
        const maxv = (1 << toBits) - 1;

        for (const value of data) {
            if (value < 0 || value >> fromBits !== 0) {
                throw new Error('Invalid data');
            }
            acc = (acc << fromBits) | value;
            bits += fromBits;
            while (bits >= toBits) {
                bits -= toBits;
                ret.push((acc >> bits) & maxv);
            }
        }

        if (pad) {
            if (bits > 0) {
                ret.push((acc << (toBits - bits)) & maxv);
            }
        } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv)) {
            throw new Error('Invalid padding');
        }

        return ret;
    },

    encodePubkey(hex) {
        const bytes = Crypto.hexToBytes(hex);
        const words = this.convertBits(bytes, 8, 5);
        return this.encode('npub', words);
    },

    encodePrivkey(hex) {
        const bytes = Crypto.hexToBytes(hex);
        const words = this.convertBits(bytes, 8, 5);
        return this.encode('nsec', words);
    },

    decodePubkey(npub) {
        const { data } = this.decode(npub);
        const bytes = this.convertBits(data, 5, 8, false);
        return Crypto.bytesToHex(new Uint8Array(bytes));
    },

    decodePrivkey(nsec) {
        const { data } = this.decode(nsec);
        const bytes = this.convertBits(data, 5, 8, false);
        return Crypto.bytesToHex(new Uint8Array(bytes));
    }
};