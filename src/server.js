const express = require('express');
const { exec } = require('child_process');
const bodyParser = require('body-parser');
const os = require('os');
const app = express();
const port = 8888;

app.use(bodyParser.json());

const runObsidianCommand = (cmd) => {
    return new Promise((resolve, reject) => {
        console.log(`Executing: ${cmd}`);
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error: ${error.message}`);
                return reject({ error: error.message, stderr });
            }
            if (stderr) {
                console.warn(`Stderr: ${stderr}`);
            }
            resolve(stdout);
        });
    });
};

app.post('/eval', async (req, res) => {
    const { vault, code } = req.body;
    if (!code) return res.status(400).json({ error: "Missing 'code' parameter" });

    const vaultArg = vault ? `vault="${vault}"` : "";
    let cmd;
    
    if (os.platform() === 'win32') {
        const escapedCode = code.replace(/"/g, '\\"');
        cmd = `obsidian ${vaultArg} eval code="${escapedCode}"`;
    } else {
        const escapedCode = code.replace(/'/g, "'\\''");
        cmd = `obsidian ${vaultArg} eval code='${escapedCode}'`;
    }

    try {
        const result = await runObsidianCommand(cmd);
        res.json({ status: "success", output: result });
    } catch (err) {
        res.status(500).json(err);
    }
});

app.post('/search', async (req, res) => {
    const { vault, query, limit } = req.body;
    if (!query) return res.status(400).json({ error: "Missing 'query' parameter" });

    const vaultArg = vault ? `vault="${vault}"` : "";
    const limitArg = limit ? `limit=${limit}` : "";
    
    const escapedQuery = query.replace(/"/g, '\\"');
    const cmd = `obsidian ${vaultArg} search query="${escapedQuery}" ${limitArg}`;

    try {
        const result = await runObsidianCommand(cmd);
        res.json({ status: "success", output: result });
    } catch (err) {
        res.status(500).json(err);
    }
});

app.get('/status', (req, res) => {
    res.json({ status: "online", message: "Obsidian Gateway is ready." });
});

app.listen(port, () => {
    console.log(`--------------------------------------------------`);
    console.log(`Obsidian HTTP Gateway running at http://localhost:${port}`);
    console.log(`Ready to bridge your Docker container to the Host Brain.`);
    console.log(`--------------------------------------------------`);
});
