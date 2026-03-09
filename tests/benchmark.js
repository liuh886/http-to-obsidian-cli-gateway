/**
 * Benchmark & Stability Test Script
 * This script verifies the performance and queue serialization of the Obsidian Gateway.
 */
const axios = require('axios');
const { performance } = require('perf_hooks');

const GATEWAY_URL = process.env.OBSIDIAN_GATEWAY_URL || 'http://localhost:8888';
const API_KEY = process.env.OBSIDIAN_GATEWAY_KEY || 'change-me-in-env';

const client = axios.create({
    baseURL: GATEWAY_URL,
    headers: { 'X-API-Key': API_KEY }
});

async function runBenchmark() {
    console.log(`Starting benchmark on ${GATEWAY_URL}...`);
    
    try {
        const health = await client.get('/health');
        console.log('✅ Health Check:', health.data);
    } catch (e) {
        console.error('❌ Health check failed. Is the server running?');
        return;
    }

    const tasks = [
        { name: 'Eval (Note Count)', endpoint: '/eval', payload: { code: 'app.vault.getMarkdownFiles().length' } },
        { name: 'Search (Keyword)', endpoint: '/search', payload: { query: 'ESG', limit: 5 } },
        { name: 'Graph (Localized)', endpoint: '/graph', payload: { central_node: 'README.md', depth: 2 } },
        { name: 'Command (Version)', endpoint: '/cmd', payload: { command: 'version' } }
    ];

    console.log('\n--- Sequential Latency ---');
    for (const task of tasks) {
        const start = performance.now();
        try {
            const res = await client.post(task.endpoint, task.payload);
            const end = performance.now();
            console.log(`[${task.name}] took ${(end - start).toFixed(2)}ms`);
        } catch (e) {
            console.log(`[${task.name}] FAILED: ${e.message}`);
        }
    }

    console.log('\n--- Parallel Stress Test (Verifying Queue Serialization) ---');
    console.log('Sending 5 concurrent requests...');
    const stressStart = performance.now();
    const results = await Promise.allSettled([
        client.post('/eval', { code: '1+1' }),
        client.post('/eval', { code: '2+2' }),
        client.post('/eval', { code: '3+3' }),
        client.post('/eval', { code: '4+4' }),
        client.post('/eval', { code: '5+5' })
    ]);
    const stressEnd = performance.now();

    const success = results.filter(r => r.status === 'fulfilled').length;
    console.log(`Completed ${success}/5 requests in ${(stressEnd - stressStart).toFixed(2)}ms`);
    console.log('Note: Total time should be slightly higher than sequential sum due to queue overhead but prevents host crashes.');

    console.log('\nBenchmark Finished.');
}

runBenchmark();
