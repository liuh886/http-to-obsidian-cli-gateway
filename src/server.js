const fastify = require('fastify')({ logger: true });
const { spawn } = require('child_process');
const PQueue = require('p-queue').default;
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Initialize serialization queue to prevent race conditions in Obsidian CLI
const queue = new PQueue({ concurrency: 1 });

// Configuration
const PORT = process.env.OBSIDIAN_GATEWAY_PORT || 8888;
const API_KEY = process.env.OBSIDIAN_GATEWAY_KEY || 'change-me-in-env';

/**
 * Executes the obsidian CLI command with serialized access via PQueue.
 * Uses child_process.spawn for better argument handling and performance.
 */
const executeCommand = (args) => {
    return queue.add(() => new Promise((resolve, reject) => {
        const startTime = Date.now();
        fastify.log.info({ args }, "Spawning obsidian process");

        const proc = spawn('obsidian', args);
        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => { stdout += data; });
        proc.stderr.on('data', (data) => { stderr += data; });

        proc.on('close', (code) => {
            const duration = Date.now() - startTime;
            if (code !== 0) {
                fastify.log.error({ code, stderr, duration }, "Obsidian process failed");
                reject({ error: `Process exited with code ${code}`, stderr, duration });
            } else {
                fastify.log.info({ duration }, "Obsidian process completed");
                resolve(stdout);
            }
        });

        proc.on('error', (err) => {
            fastify.log.error({ err }, "Failed to start obsidian process");
            reject({ error: err.message });
        });
    }));
};

// Security: Simple API Key Authentication Middleware
fastify.addHook('preHandler', async (request, reply) => {
    // Skip auth for health check if desired, or keep it consistent
    if (request.url === '/health') return;

    const apiKey = request.headers['x-api-key'];
    if (!apiKey || apiKey !== API_KEY) {
        reply.code(401).send({ error: 'Unauthorized: Invalid or missing API Key' });
    }
});

// Endpoint: Evaluate dynamic JavaScript within Obsidian
fastify.post('/eval', async (request, reply) => {
    const { vault, code } = request.body;
    if (!code) return reply.status(400).send({ error: 'Missing code' });

    const args = [];
    if (vault) args.push(`vault=${vault}`);
    args.push('eval');
    args.push(`code=${code}`);

    try {
        const result = await executeCommand(args);
        return { status: 'success', output: result };
    } catch (err) {
        return reply.status(500).send(err);
    }
});

// Endpoint: Global Fuzzy Search (leveraging metadataCache for speed)
fastify.post('/search', async (request, reply) => {
    const { vault, query, limit = 10 } = request.body;
    if (!query) return reply.status(400).send({ error: 'Missing query' });

    // Sanitize query by using JSON.stringify to escape it for the JS payload
    const sanitizedQuery = JSON.stringify(query.toLowerCase());
    
    // JS code to execute inside Obsidian context
    const code = `(() => {
        const q = ${sanitizedQuery};
        const files = Object.keys(app.metadataCache.fileCache)
            .filter(path => path.toLowerCase().includes(q.replace(/"/g, '')))
            .slice(0, ${limit});
        return JSON.stringify(files);
    })()`;

    const args = [];
    if (vault) args.push(`vault=${vault}`);
    args.push('eval');
    args.push(`code=${code}`);

    try {
        const result = await executeCommand(args);
        // Attempt to parse result if it's JSON string from eval
        try {
            return { status: 'success', output: JSON.parse(result) };
        } catch (e) {
            return { status: 'success', output: result };
        }
    } catch (err) {
        return reply.status(500).send(err);
    }
});

// Endpoint: Localized Knowledge Graph Traversal
fastify.post('/graph', async (request, reply) => {
    const { vault, central_node, depth = 2 } = request.body;
    if (!central_node) return reply.status(400).send({ error: 'Missing central_node (file path)' });

    // JS code to perform BFS traversal in Obsidian
    const code = `(() => {
        const centralNode = ${JSON.stringify(central_node)};
        const maxDepth = ${depth};
        const nodes = new Set();
        const edges = [];
        const visited = new Set();
        const queue = [{ path: centralNode, depth: 0 }];

        const resolvedLinks = app.metadataCache.resolvedLinks;
        
        // Helper to find backlinks (nodes that link TO current)
        const findBacklinks = (targetPath) => {
            const backlinks = [];
            for (const [sourcePath, links] of Object.entries(resolvedLinks)) {
                if (links[targetPath]) {
                    backlinks.push(sourcePath);
                }
            }
            return backlinks;
        };

        while (queue.length > 0) {
            const { path, depth } = queue.shift();
            if (visited.has(path)) continue;
            visited.add(path);
            nodes.add(path);

            if (depth < maxDepth) {
                // Outbound links (from current)
                const outbound = Object.keys(resolvedLinks[path] || {});
                for (const neighbor of outbound) {
                    edges.push({ source: path, target: neighbor });
                    if (!visited.has(neighbor)) {
                        queue.push({ path: neighbor, depth: depth + 1 });
                    }
                }

                // Inbound links (backlinks to current)
                const inbound = findBacklinks(path);
                for (const neighbor of inbound) {
                    edges.push({ source: neighbor, target: path });
                    if (!visited.has(neighbor)) {
                        queue.push({ path: neighbor, depth: depth + 1 });
                    }
                }
            }
        }

        return JSON.stringify({
            nodes: Array.from(nodes),
            edges: edges
        });
    })()`;

    const args = [];
    if (vault) args.push(`vault=${vault}`);
    args.push('eval');
    args.push(`code=${code}`);

    try {
        const result = await executeCommand(args);
        try {
            return { status: 'success', output: JSON.parse(result) };
        } catch (e) {
            return { status: 'success', output: result };
        }
    } catch (err) {
        return reply.status(500).send(err);
    }
});

// Endpoint: Execute standard Obsidian CLI commands
fastify.post('/cmd', async (request, reply) => {
    const { vault, command, args: cmdArgs } = request.body;
    if (!command) return reply.status(400).send({ error: 'Missing command' });

    const args = [];
    if (vault) args.push(`vault=${vault}`);
    args.push(command);

    if (Array.isArray(cmdArgs)) {
        args.push(...cmdArgs);
    } else if (cmdArgs) {
        args.push(cmdArgs);
    }

    try {
        const result = await executeCommand(args);
        return { status: 'success', output: result };
    } catch (err) {
        return reply.status(500).send(err);
    }
});

// Endpoint: Health check & Dependency Verification
fastify.get('/health', async (request, reply) => {
    try {
        // Run a no-op command to check if CLI is responsive
        const result = await executeCommand(['version']);
        return { 
            status: 'ok', 
            service: 'http-to-obsidian-cli-gateway',
            obsidian_cli: result.trim(),
            queue_depth: queue.size
        };
    } catch (err) {
        return reply.status(503).send({ 
            status: 'degraded', 
            error: 'Obsidian CLI not responding',
            details: err 
        });
    }
});

// Start Server
const start = async () => {
    try {
        await fastify.listen({ port: PORT, host: '0.0.0.0' });
        console.log(`🚀 Obsidian Optimized Gateway listening on port ${PORT}`);
        if (API_KEY === 'change-me-in-env') {
            console.warn('⚠️ WARNING: Using default API Key. Please set OBSIDIAN_GATEWAY_KEY in .env');
        }
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
