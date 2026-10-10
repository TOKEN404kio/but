import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import ModelClient from '@azure-rest/ai-inference';
import { AzureKeyCredential } from '@azure/core-auth';
import { Octokit } from '@octokit/rest';
import axios from 'axios';

const aiClient = ModelClient(
  "https://azure.com",
  new AzureKeyCredential(process.env.GITHUB_TOKEN)
);

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

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

    try {
        const response = await aiClient.path("/chat/completions").post({
          body: {
            model: "meta-llama-3.3-70b-instruct", 
            messages: [
              { 
                role: "system", 
                content: "You are an automated code generator. You must ONLY output a single, complete HTML document containing internal CSS and Javascript. Do NOT include any introductory sentences, explanations, or markdown code block formatting like ```html. Start directly with <!DOCTYPE html>." 
              },
              { role: "user", content: prompt }
            ]
          }
        });

        if (response.status !== "200") {
          throw new Error("AI generation failed");
        }

        let htmlCode = response.body.choices.message.content.trim();

        if (htmlCode.includes('```')) {
            htmlCode = htmlCode.replace(/```html/gi, '').replace(/```/g, '').trim();
        }

        if (!htmlCode.startsWith('<!DOCTYPE') && !htmlCode.startsWith('<html')) {
            htmlCode = `<!DOCTYPE html><html><head><title>Generated Site</title></head><body>${htmlCode}</body></html>`;
        }

        await statusMessage.edit('⏳ **Step 2/3:** Creating a new GitHub repository...');

        const repoName = `user-site-${Date.now()}`;
        
        const repoSetup = await octokit.repos.createForAuthenticatedUser({
            name: repoName,
            private: false, 
            auto_init: true
        });

        const owner = repoSetup.data.owner.login;

        await octokit.repos.createOrUpdateFileContents({
            owner,
            repo: repoName,
            path: 'index.html',
            message: 'Initial website build from Discord',
            content: Buffer.from(htmlCode).toString('base64')
        });

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

    } catch (error) {
        console.error(error);
        await statusMessage.edit('❌ An error occurred while generating or deploying your website.');
    }
});

client.login(process.env.DISCORD_TOKEN);
