const dotenv = require('dotenv');
dotenv.config();

const fastify = require('fastify')({ logger: true });
const { spawn } = require('child_process');
const PQueue = require('p-queue').default;
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ... (previous imports and setup)

/**
 * Endpoint: Get Physical Metadata (Hash/Size) for Drift Detection
 */
fastify.post('/metadata', async (request, reply) => {
    const { target } = request.body;
    if (!target) return reply.status(400).send({ error: 'Missing target' });

    const physicalPath = resolveAlias(target);
    const fullPath = path.join(VAULT_PATH, physicalPath);

    if (!fs.existsSync(fullPath)) {
        return reply.status(404).send({ error: `File not found: ${physicalPath}` });
    }

    try {
        const fileBuffer = fs.readFileSync(fullPath);
        const hash = crypto.createHash('md5').update(fileBuffer).digest('hex');
        const stats = fs.statSync(fullPath);

        return {
            status: 'success',
            path: physicalPath,
            hash: hash,
            size: stats.size,
            mtime: stats.mtime
        };
    } catch (err) {
        return reply.status(500).send({ error: 'Failed to read metadata', details: err.message });
    }
});

// Initialize serialization queue
const queue = new PQueue({ concurrency: 1 });

// Configuration
const PORT = process.env.OBSIDIAN_GATEWAY_PORT || 8742;
const HOST = process.env.OBSIDIAN_GATEWAY_HOST || '127.0.0.1';
const API_KEY = process.env.OBSIDIAN_GATEWAY_KEY;
const VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH || '/mnt/zhihaol';
const OBSIDIAN_BIN = process.env.OBSIDIAN_BIN || (
    process.platform === 'win32'
        ? path.join(process.env.LOCALAPPDATA || '', 'Obsidian', 'Obsidian.exe')
        : 'obsidian'
);

if (!API_KEY) {
    console.error('CRITICAL ERROR: OBSIDIAN_GATEWAY_KEY is not set. Service will refuse all requests.');
}

/**
 * Semantic Alias Resolver
 */
const resolveAlias = (alias) => {
    const now = new Date();
    const isoDate = now.toISOString().split('T')[0];
    const year = now.getFullYear();
    
    const aliases = {
        '@daily': `000_Inbox/Daily_Note/${isoDate}.md`,
        '@inbox': `000_Inbox/Inbox.md`,
        '@bio': `400_Archives/Biography/${year}.md`,
        '@log': `100_Logs/System_Log.md`,
        '@nexus': `200_Area/Contacts/Registry.md`
    };
    
    if (aliases[alias]) return aliases[alias];
    // V11 SOTA: If alias starts with '@' but is not in the map, strip '@' to allow physical path escaping
    if (alias.startsWith('@')) return alias.substring(1);
    return alias;
};

/**
 * Executes the obsidian CLI command with serialized access via PQueue.
 */
const executeCommand = (args) => {
    return queue.add(() => new Promise((resolve, reject) => {
        const startTime = Date.now();
        fastify.log.info({ args }, "Spawning obsidian process");

        const proc = spawn(OBSIDIAN_BIN, args, {
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
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
    if (request.url === '/health') return;
    const apiKey = request.headers['x-api-key'];
    if (!apiKey || apiKey !== API_KEY) {
        reply.code(401).send({ error: 'Unauthorized: Invalid or missing API Key' });
    }
});

/**
 * Endpoint: Write to a controlled block with anchor ULID
 */
fastify.post('/write_block', async (request, reply) => {
    const { vault, target, block_id, content } = request.body;
    if (!target || !block_id || content === undefined) {
        return reply.status(400).send({ error: 'Missing target, block_id, or content' });
    }

    const physicalPath = resolveAlias(target);
    const fullPath = path.join(VAULT_PATH, physicalPath);

    if (!fs.existsSync(fullPath)) {
        return reply.status(404).send({ error: `File not found: ${physicalPath}` });
    }

    let fileContent = fs.readFileSync(fullPath, 'utf8');
    const beginMarker = `<!-- LIFEOS:${block_id.toUpperCase()}:START -->`;
    const endMarker = `<!-- LIFEOS:${block_id.toUpperCase()}:END -->`;
    
    const startIdx = fileContent.indexOf(beginMarker);
    const endIdx = fileContent.indexOf(endMarker);

    let newContent;
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        newContent = fileContent.slice(0, startIdx + beginMarker.length) +
                     `\n${content}\n` +
                     fileContent.slice(endIdx);
    } else {
        newContent = fileContent.trimEnd() + `\n\n${beginMarker}\n${content}\n${endMarker}\n`;
    }

    fs.writeFileSync(fullPath, newContent, 'utf8');
    return { status: 'success', path: physicalPath, block: block_id };
});

/**
 * Endpoint: Append under a Markdown Header
 */
fastify.post('/append_section', async (request, reply) => {
    const { vault, target, header, content } = request.body;
    if (!target || !header || !content) {
        return reply.status(400).send({ error: 'Missing target, header, or content' });
    }

    const physicalPath = resolveAlias(target);
    const fullPath = path.join(VAULT_PATH, physicalPath);

    if (!fs.existsSync(fullPath)) {
        // Create if missing
        fs.writeFileSync(fullPath, `## ${header}\n\n${content}\n`, 'utf8');
        return { status: 'success', path: physicalPath, action: 'created' };
    }

    let fileContent = fs.readFileSync(fullPath, 'utf8');
    const headerPattern = new RegExp(`^#+\\s+${header}\\s*$`, 'm');
    const match = fileContent.match(headerPattern);

    let newContent;
    if (match) {
        const headerEndIdx = match.index + match[0].length;
        newContent = fileContent.slice(0, headerEndIdx) + `\n${content}` + fileContent.slice(headerEndIdx);
    } else {
        newContent = fileContent.trimEnd() + `\n\n## ${header}\n\n${content}\n`;
    }

    fs.writeFileSync(fullPath, newContent, 'utf8');
    return { status: 'success', path: physicalPath, section: header };
});

/**
 * SECURITY WARNING: The /eval endpoint allows execution of arbitrary JavaScript.
 * This is a Remote Code Execution (RCE) risk. Ensure this service is ONLY accessible
 * from trusted local networks or via secure, authenticated tunnels.
 */
fastify.post('/eval', async (request, reply) => {
    const { vault, code } = request.body;
    if (!code) return reply.status(400).send({ error: 'Missing code' });
    const args = [];
    if (vault) args.push(`vault=${vault}`);
    args.push('eval', `code=${code}`);
    try {
        const result = await executeCommand(args);
        return { status: 'success', output: result };
    } catch (err) { return reply.status(500).send(err); }
});

// Endpoint: Health check
fastify.get('/health', async (request, reply) => {
    return { status: 'ok', service: 'http-to-obsidian-cli-gateway-v11' };
});

// Standard CMD Proxy
fastify.post('/cmd', async (request, reply) => {
    const { vault, command, args: cmdArgs } = request.body;
    const args = [];
    if (vault) args.push(`vault=${vault}`);
    args.push(command);
    if (Array.isArray(cmdArgs)) args.push(...cmdArgs);
    else if (cmdArgs) args.push(cmdArgs);
    try {
        const result = await executeCommand(args);
        return { status: 'success', output: result };
    } catch (err) { return reply.status(500).send(err); }
});

const start = async () => {
    try {
        await fastify.listen({ port: PORT, host: HOST });
        console.log(`🚀 Obsidian V11 Bridge listening on ${HOST}:${PORT}`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
