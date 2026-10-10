import 'dotenv/config';
import { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';
import { Octokit } from '@octokit/rest';
import axios from 'axios';
import http from 'http';

// --- KEEP RENDER WEB SERVICE ALIVE ---
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Discord Bot is running 24/7!\n');
}).listen(PORT, () => {
    console.log(`🌐 Fake web server listening on port \${PORT}`);
});

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const PREFIX = '!generate';
const OWNER_ID = '1520467898995577078'; // Your User ID

client.once('ready', () => {
    console.log(`🤖 Private Admin Diagnostic Bot Online!`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    const prompt = message.content.replace(PREFIX, '').trim();
    if (!prompt) {
        return message.reply('Please provide a description!');
    }

    const isOwner = message.author.id === OWNER_ID;
    const statusMessage = await message.reply('⏳ **Step 1/3:** Asking GitHub AI to write the raw code...');
    
    let htmlCode = '';
    let repoName = `user-site-\${Date.now()}`;
    let owner = '';

    // === FUNCTION TO CAPTURE DEEP SYSTEM DIAGNOSTICS ===
    async function handlePipelineError(errorObj, stepNumber, stepName) {
        console.error(`CRASH AT STEP \${stepNumber}:`, errorObj);

        const errorStack = errorObj.stack || "No call stack available";
        const axiosDump = errorObj.config ? {
            targetUrl: errorObj.config.url,
            methodUsed: errorObj.config.method,
            sentPayload: errorObj.config.data,
            authHeaderPresent: !!errorObj.config.headers?.['Authorization']
        } : "Not an Axios network request error";

        const diagnosticPayload = `🚨 **DEEP DIAGNOSTIC REPORT (STEP stepNumber - {stepName})**\n` +
            `👤 **Triggered By:** <@message.author.id> ({message.author.username})\n` +
            `💬 **Prompt Used:** \`${prompt}\`\n\n` +
            `❌ **Raw Message:** \`${errorObj.message || errorObj}\`\n` +
            `📂 **Network Trace:**\`\`\`json\n${JSON.stringify(axiosDump, null, 2)}\n\`\`\`\n` +
            `📌 **Engine Call Stack:**\`\`\`text\n${errorStack.slice(0, 1000)}\n\`\`\``;

        // FIXED: Direct routing straight to your DMs so it never disappears
        if (isOwner) {
            try {
                await message.author.send(diagnosticPayload);
                await statusMessage.edit(`❌ **Step ${stepNumber} Failed.** I have sent the deep technical logs straight to your private DMs! 📩`);
            } catch (dmErr) {
                await statusMessage.edit(`❌ **Step ${stepNumber} Failed.** I tried to DM you the logs, but your private DMs are closed! Change your Discord privacy settings.`);
            }
            return;
        }

        // If a general user triggered it, show a clean message with a button to send to you
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('send_to_owner')
                .setLabel('📩 Send Error Report to Owner')
                .setStyle(ButtonStyle.Danger)
        );

        const publicAlert = await statusMessage.edit({
            content: `❌ **An unexpected error occurred while compiling your site build at Step ${stepNumber}.** The administrator has been logged.`,
            components: [row]
        });

        const collector = publicAlert.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 60000 
        });

        collector.on('collect', async (interaction) => {
            try {
                const adminUser = await client.users.fetch(OWNER_ID);
                await adminUser.send(diagnosticPayload);
                await interaction.reply({ content: '✅ Diagnostics have been securely sent to the owner\'s private DMs!', ephemeral: true });
            } catch (dmErr) {
                console.error("DM Routing Failed:", dmErr);
                await interaction.reply({ content: '❌ Could not send DM. Please check if the owner has DMs opened.', ephemeral: true });
            }
        });
    }

    // === STEP 1: AI GENERATION ===
    try {
        const response = await axios.post(
            'https://azure.com',
            {
                model: "meta-llama-3.3-70b-instruct",
                messages: [
                    { role: "system", content: "You are an automated code generator. You must ONLY output a single, complete HTML document containing internal CSS and Javascript. Do NOT include markdown code blocks. Start directly with <!DOCTYPE html>." },
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
        } else {
            throw new Error(`Unexpected AI JSON response format: ${JSON.stringify(response.data)}`);
        }

        if (htmlCode.includes('```')) {
            htmlCode = htmlCode.replace(/```html/gi, '').replace(/```/g, '').trim();
        }
    } catch (aiError) {
        return await handlePipelineError(aiError, 1, "AI Generation Engine");
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
        return await handlePipelineError(githubError, 2, "GitHub Repository Infrastructure");
    }

    // === STEP 3: RENDER DEPLOYMENT ===
    try {
        await statusMessage.edit('⏳ **Step 3/3:** Deploying live to Render...');

        const renderResponse = await axios.post(
            'https://render.com',
            {
                type: 'static_site',
                name: repoName,
                repo: `https://github.com{owner}/${repoName}`,
                autoDeploy: 'yes',
                staticSiteDetails: {
                    publishDir: '.'
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.RENDER_API_KEY}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            }
        );

        const liveUrl = renderResponse.data.url || `https://${repoName}.onrender.com`;
        await statusMessage.edit(`🎉 **Success!** Your website code was pushed and deployed.\n\n📂 **GitHub Repo:** https://github.com{owner}/${repoName}\n🌐 **Live Link:** ${liveUrl}`);

    } catch (renderError) {
        return await handlePipelineError(renderError, 3, "Render Cloud Deployment Engine");
    }
});

client.login(process.env.DISCORD_TOKEN);
