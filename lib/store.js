import fs from 'fs';
import path from 'path';

const DATA_FILE = path.join(process.cwd(), 'data', 'store.json');

const DEFAULT_DATA = {
    tokens: [],
    agents: [],
    stats: {
        totalTokensLaunched: 0,
        totalVolume: 0,
        totalFeesDistributed: 0,
        totalAgents: 0,
        lastUpdated: new Date().toISOString()
    }
};

export function readData() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            const dir = path.dirname(DATA_FILE);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_DATA, null, 2));
            return structuredClone(DEFAULT_DATA);
        }
        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(raw);
    } catch (error) {
        console.error('Error reading data:', error);
        return structuredClone(DEFAULT_DATA);
    }
}

export function writeData(data) {
    try {
        const dir = path.dirname(DATA_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        data.stats.lastUpdated = new Date().toISOString();
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error writing data:', error);
    }
}
