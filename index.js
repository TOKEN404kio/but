import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { OpenAI } from 'openai';
import { Octokit } from '@octokit/rest';
import axios from 'axios';
import http from 'http';

// --- KEEP RENDER WEB SERVICE ALIVE ---
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Discord Bot is running 24/7!\n');
}).listen(PORT, () => {
    console.log(`🌐 Web check handler online on port ${PORT}`);
});

// Use GitHub's standard universal API routing to fix the 301 redirect error
const aiClient = new OpenAI({
  baseURL: "https://azure.com",
  apiKey: process.env.GITHUB_TOKEN
});

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const PREFIX = '!generate';

client.once('ready', () => {
    console.log(`🤖 Bot is online and listening via the standard OpenAI package!`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    const prompt = message.content.replace(PREFIX, '').trim();
    if (!prompt) {
        return message.reply('Please provide a description for the website!');
    }

    const statusMessage = await message.reply('⏳ **Step 1/3:** Asking AI to write your source code...');
    let htmlCode = '';
    let repoName = `user-site-${Date.now()}`;
    let owner = '';

    // === STEP 1: GENERATE SITE CODE ===
    try {
        const response = await aiClient.chat.completions.create({
            model: "meta-llama-3.3-70b-instruct", 
            messages: [
              { 
                role: "system", 
                content: "You are an automated code generator. You must ONLY output a single, complete HTML document containing internal CSS and Javascript. Do NOT include markdown code block formatting like ```html. Start directly with <!DOCTYPE html>." 
              },
              { role: "user", content: prompt }
            ]
        });

        htmlCode = response.choices[0].message.content.trim();

        if (htmlCode.includes('```')) {
            htmlCode = htmlCode.replace(/```html/gi, '').replace(/```/g, '').trim();
        }
    } catch (aiError) {
        console.error("AI GENERATION STEP FAILED:", aiError);
        return await statusMessage.edit(`❌ **CRITICAL ERROR AT STEP 1 (AI Generation Failed):**\n\`\`\`text\n${aiError.message || aiError}\n\`\`\``);
    }

    // === STEP 2: PUSH RAW FILE TO GITHUB ===
    try {
        await statusMessage.edit('⏳ **Step 2/3:** Setting up your public GitHub repository...');
        
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
        console.error("GITHUB INTERACTION FAILED:", githubError);
        return await statusMessage.edit(`❌ **CRITICAL ERROR AT STEP 2 (GitHub Upload Failed):**\n\`\`\`text\n${githubError.message || githubError}\n\`\`\``);
    }

    // === STEP 3: DEPLOY HOSTING SERVICE VIA RENDER ===
    try {
        await statusMessage.edit('⏳ **Step 3/3:** Sending production build to Render...');

        const renderResponse = await axios.post(
            'https://render.com',
            {
                type: 'static_site',
                name: repoName,
                repo: `https://github.com/\({owner}/\){repoName}`,
                autoDeploy: 'yes',
                serviceDetails: {
                    publishDir: '.' 
                }
            },
            {
                headers: {
                    Authorization: `Bearer \${process.env.RENDER_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const liveUrl = renderResponse.data.serviceDetails.url || `https://\${repoName}.onrender.com`;

        await statusMessage.edit(`🎉 **Success!** Your website code was pushed and deployed.\n\n📂 **GitHub Repo:** https://github.com/\({owner}/\){repoName}\n🌐 **Live Link:** \${liveUrl}`);

    } catch (renderError) {
        console.error("RENDER DEPLOYMENT FAILED:", renderError);
        const serverMessage = renderError.response?.data?.message || renderError.message;
        return await statusMessage.edit(`❌ **CRITICAL ERROR AT STEP 3 (Render Link Failed):**\n\`\`\`text\n${serverMessage}\n\`\`\``);
    }
});

client.login(process.env.DISCORD_TOKEN);
