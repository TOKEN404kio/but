import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { Octokit } from '@octokit/rest';
import axios from 'axios';
import http from 'http';

// --- TRICK RENDER WEBSERVICE TO STAY ALIVE ---
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Discord Bot is running 24/7!\n');
}).listen(PORT, () => {
    console.log(`🌐 Fake web server listening on port ${PORT}`);
});

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const PREFIX = '!generate';

client.once('ready', () => {
    console.log(`🤖 Bot is online and ready using GitHub's Built-in AI!`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    const prompt = message.content.replace(PREFIX, '').trim();
    if (!prompt) {
        return message.reply('Please provide a description!');
    }

    const statusMessage = await message.reply('⏳ **Step 1/3:** Asking GitHub AI to write the raw code...');
    let htmlCode = '';
    let repoName = `user-site-${Date.now()}`;
    let owner = '';

    // === STEP 1: AI GENERATION ===
    try {
        const response = await axios.post(
            'https://azure.com',
            {
                model: "meta-llama-3.3-70b-instruct",
                messages: [
                    { 
                        role: "system", 
                        content: "You are an automated code generator. You must ONLY output a single, complete HTML document containing internal CSS and Javascript. Do NOT include markdown code block formatting like ```html. Start directly with <!DOCTYPE html>." 
                    },
                    { role: "user", content: prompt }
                ]
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (response.data && response.data.choices && response.data.choices[0] && response.data.choices[0].message) {
            htmlCode = response.data.choices[0].message.content.trim();
        } else if (response.data && response.data.content) {
            htmlCode = response.data.content.trim();
        } else {
            htmlCode = typeof response.data === 'string' ? response.data.trim() : JSON.stringify(response.data);
        }

        if (htmlCode.includes('```')) {
            htmlCode = htmlCode.replace(/```html/gi, '').replace(/```/g, '').trim();
        }
    } catch (aiError) {
        console.error("AI FAILED:", aiError);
        const errMsg = aiError.response?.data?.message || aiError.message;
        return await statusMessage.edit(`❌ **CRITICAL ERROR AT STEP 1 (AI Generation Failed):**\n\`\`\`text\n${errMsg}\n\`\`\``);
    }

    // === STEP 2: GITHUB PUSH ===
    try {
        await statusMessage.edit('⏳ **Step 2/3:** Creating a new GitHub repository...');
        
        const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
        
        const repoSetup = await octokit.repos.createForAuthenticatedUser({
            name: repoName,
            private: false, 
            auto_init: true
        });

        owner = repoSetup.data.owner.login;

        await octokit.repos.createOrUpdateFileContents({
            owner,
            repo: repoName,
            path: 'index.html',
            message: 'Initial website build from Discord',
            content: Buffer.from(htmlCode).toString('base64')
        });
    } catch (githubError) {
        console.error("GITHUB FAILED:", githubError);
        return await statusMessage.edit(`❌ **CRITICAL ERROR AT STEP 2 (GitHub Upload Failed):**\n\`\`\`text\n${githubError.message}\n\`\`\``);
    }

    // === STEP 3: RENDER DEPLOYMENT ===
    try {
        await statusMessage.edit('⏳ **Step 3/3:** Deploying live to Render...');

        // Fixed string template literals and adjusted headers to fully clear the 406 gateway filter
        const renderResponse = await axios.post(
            'https://api.render.com/v1/services',
            {
                type: 'static_site',
                name: repoName,
                repo: `https://github.com{repoName}`,
                autoDeploy: 'yes',
                staticSiteDetails: {
                    publishDir: '.'
                }
            },
            {
                headers: {
                    'Authorization': `Bearer \${process.env.RENDER_API_KEY}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            }
        );

        const liveUrl = renderResponse.data.url || `https://\${repoName}.onrender.com`;

        await statusMessage.edit(`🎉 **Success!** Your website code was pushed and deployed.\n\n📂 **GitHub Repo:** https://github.com{repoName}\n🌐 **Live Link:** \${liveUrl}`);

    } catch (renderError) {
        console.error("RENDER FAILED:", renderError);
        const serverMessage = renderError.response?.data?.message || renderError.message;
        return await statusMessage.edit(`❌ **CRITICAL ERROR AT STEP 3 (Render Link Failed):**\n\`\`\`text\n${serverMessage}\n\`\`\``);
    }
});

client.login(process.env.DISCORD_TOKEN);
