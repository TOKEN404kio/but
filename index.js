import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import ModelClient from '@azure-rest/ai-inference';
import { AzureKeyCredential } from '@azure/core-auth';
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
    console.log(`🤖 Bot is online and ready using GitHub Models!`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    const prompt = message.content.replace(PREFIX, '').trim();
    if (!prompt) {
        return message.reply('Please provide a description!');
    }

    const statusMessage = await message.reply('⏳ **Step 1/3:** Asking AI to write the raw code...');
    let htmlCode = '';
    let repoName = `user-site-${Date.now()}`;
    let owner = '';

    // === DIAGNOSTIC STEP 1: AI GENERATION ===
    try {
        const aiClient = ModelClient(
          "https://azure.com",
          new AzureKeyCredential(process.env.GITHUB_TOKEN || '')
        );

        const response = await aiClient.path("/chat/completions").post({
          body: {
            model: "Mistral-large-2411", 
            messages: [
              { 
                role: "system", 
                content: "You are an automated code generator. You must ONLY output a single, complete HTML document containing internal CSS and Javascript. Do NOT include markdown code block formatting like ```html." 
              },
              { role: "user", content: prompt }
            ]
          }
        });

        if (response.status !== "200") {
            throw new Error(`GitHub AI responded with error status: ${response.status}`);
        }

        htmlCode = response.body.choices.message.content.trim();

        if (htmlCode.includes('```')) {
            htmlCode = htmlCode.replace(/```html/gi, '').replace(/```/g, '').trim();
        }
    } catch (aiError) {
        console.error("AI FAILED:", aiError);
        return await statusMessage.edit(`❌ **CRITICAL ERROR AT STEP 1 (AI Generation Failed):**\n\`\`\`text\n\${aiError.message || aiError}\n\`\`\`\n*Tip: Check if your GITHUB_TOKEN environment variable is set up correctly in Render.*`);
    }

    // === DIAGNOSTIC STEP 2: GITHUB PUSH ===
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
        return await statusMessage.edit(`❌ **CRITICAL ERROR AT STEP 2 (GitHub Upload Failed):**\n\`\`\`text\n\${githubError.message || githubError}\n\`\`\`\n*Tip: Ensure your GitHub Token has full 'repo' permission checkboxes enabled.*`);
    }

    // === DIAGNOSTIC STEP 3: RENDER DEPLOYMENT ===
    try {
        await statusMessage.edit('⏳ **Step 3/3:** Deploying live to Render...');

        const renderResponse = await axios.post(
            'https://render.com',
            {
                type: 'static_site',
                name: repoName,
                repo: `https://github.com{owner}/${repoName}`,
                autoDeploy: 'yes',
                serviceDetails: {
                    publishDir: '.' 
                }
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.RENDER_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const liveUrl = renderResponse.data.serviceDetails.url || `https://${repoName}.onrender.com`;

        await statusMessage.edit(`🎉 **Success!** Your website code was pushed and deployed.\n\n📂 **GitHub Repo:** https://github.com{owner}/${repoName}\n🌐 **Live Link:** ${liveUrl}`);

    } catch (renderError) {
        console.error("RENDER FAILED:", renderError);
        const serverMessage = renderError.response?.data?.message || renderError.message;
        return await statusMessage.edit(`❌ **CRITICAL ERROR AT STEP 3 (Render Link Failed):**\n\`\`\`text\n\${serverMessage}\n\`\`\`\n*Tip: Verify your RENDER_API_KEY inside Render Environment dashboard is exact.*`);
    }
});

client.login(process.env.DISCORD_TOKEN);
