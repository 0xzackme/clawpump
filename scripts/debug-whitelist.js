// Debug script to check whitelist configuration
import 'dotenv/config';
import { isWhitelisted, canAgentLaunch } from './lib/solana-balance.js';

const testAddress = '1nc1nerator11111111111111111111111111111111';

console.log('=== Whitelist Debug ===');
console.log('LAUNCH_WHITELIST env var:', process.env.LAUNCH_WHITELIST);
console.log('Parsed whitelist:', (process.env.LAUNCH_WHITELIST || '').split(',').map(w => w.trim()).filter(Boolean));
console.log('Test address:', testAddress);
console.log('Is whitelisted?', isWhitelisted(testAddress));

// Test the full check
canAgentLaunch(testAddress).then(result => {
    console.log('\nFull check result:', result);
}).catch(err => {
    console.error('Error:', err);
});
