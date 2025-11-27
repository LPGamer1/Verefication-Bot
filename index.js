require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, 
    TextInputStyle, PermissionsBitField 
} = require('discord.js');

// --- VARIÁVEIS DE CONFIGURAÇÃO ---
// Canal onde o bot vai avisar que alguém se registrou (O Log)
// Substitua pelo ID do CANAL de logs dentro do servidor 1443598173024288881
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID; 

const app = express();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// BANCO DE DADOS TEMPORÁRIO (Memória)
// Guarda o token do usuário: Map<UserID, AccessToken>
// Aviso: Se o bot reiniciar na hospedagem, esses tokens somem.
const userTokens = new Map();

// --- SERVIDOR WEB (Recebe o Login) ---
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

        const { access_token, refresh_token } = tokenResponse.data;

        // 2. Pega dados do Usuário
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${access_token}` },
        });

        const user = userResponse.data;

        // 3. Salva o Token na memória vinculado ao ID do usuário
        userTokens.set(user.id, access_token);

        // 4. Envia o LOG para o canal de Admin
        const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
        if (logChannel) {
            const embedLog = new EmbedBuilder()
                .setTitle('📥 Novo Usuário Autorizado')
                .setThumbnail(`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`)
                .addFields(
                    { name: 'Usuário', value: `${user.username} (${user.id})`, inline: true },
                    { name: 'Status', value: '🟢 Token Salvo (Pronto para mover)', inline: true }
                )
                .setColor(0x00FF00)
                .setFooter({ text: 'Aguardando comando de envio...' });

            // Botão que carrega o ID do usuário no customId
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`btn_abrir_envio_${user.id}`) // Guarda o ID aqui
                    .setLabel('Enviar para um Servidor')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('✈️')
            );

            await logChannel.send({ embeds: [embedLog], components: [row] });
        }

        // 5. Resposta para o Usuário no Navegador
        res.send(`
            <html>
                <body style="background-color: #2b2d31; color: white; font-family: sans-serif; text-align: center; padding-top: 50px;">
                    <h1>✅ Verificado!</h1>
                    <p>Você foi autenticado. Pode fechar esta janela.</p>
                </body>
            </html>
        `);

    } catch (error) {
        console.error(error);
        res.send('❌ Erro na autenticação.');
    }
});

app.listen(process.env.PORT || 3000);


// --- BOT DISCORD ---
client.once('ready', async () => {
    console.log(`🤖 Manager Bot Online: ${client.user.tag}`);
    
    // Registra o comando de Setup
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
    
    // 1. SETUP DO PAINEL (Onde o usuário clica)
    if (interaction.isChatInputCommand() && interaction.commandName === 'setup_auth') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;

        const authUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify+guilds.join`;

        const embed = new EmbedBuilder()
            .setTitle('🛡️ Verificação de Segurança')
            .setDescription('Clique no botão abaixo para se verificar e liberar seu acesso.')
            .setColor(0x5865F2);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setLabel('Verificar Agora').setStyle(ButtonStyle.Link).setURL(authUrl).setEmoji('🛡️')
        );

        await interaction.channel.send({ embeds: [embed], components: [row] });
        await interaction.reply({ content: 'Painel criado!', ephemeral: true });
    }

    // 2. BOTÃO NO CANAL DE LOGS (Admin clica "Enviar")
    if (interaction.isButton() && interaction.customId.startsWith('btn_abrir_envio_')) {
        // Extrai o ID do usuário do botão
        const targetUserId = interaction.customId.split('_')[3];

        // Cria o Modal (Janelinha para digitar o ID do servidor)
        const modal = new ModalBuilder()
            .setCustomId(`modal_envio_${targetUserId}`) // Passa o ID do usuário pro Modal
            .setTitle('Enviar Usuário');

        const serverIdInput = new TextInputBuilder()
            .setCustomId('input_server_id')
            .setLabel("ID do Servidor Alvo")
            .setPlaceholder("Cole o ID do servidor aqui (O BOT PRECISA ESTAR LÁ)")
            .setStyle(TextInputStyle.Short);

        modal.addComponents(new ActionRowBuilder().addComponents(serverIdInput));
        await interaction.showModal(modal);
    }

    // 3. RESPOSTA DO MODAL (Faz a mágica acontecer)
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_envio_')) {
        const targetUserId = interaction.customId.split('_')[2];
        const targetServerId = interaction.fields.getTextInputValue('input_server_id');

        await interaction.deferReply({ ephemeral: true });

        // Recupera o token da memória
        const accessToken = userTokens.get(targetUserId);

        if (!accessToken) {
            return interaction.editReply('❌ **Erro:** O token desse usuário expirou ou o bot reiniciou. Peça para ele se verificar novamente.');
        }

        try {
            // Tenta adicionar o usuário no servidor escolhido
            await axios.put(
                `https://discord.com/api/guilds/${targetServerId}/members/${targetUserId}`,
                { access_token: accessToken },
                { 
                    headers: { Authorization: `Bot ${process.env.BOT_TOKEN}` } 
                }
            );

            await interaction.editReply(`✅ **Sucesso!** O usuário <@${targetUserId}> foi adicionado ao servidor ID: \`${targetServerId}\`.`);

        } catch (erro) {
            console.error(erro.response ? erro.response.data : erro);
            
            let msgErro = 'Falha ao adicionar.';
            if (erro.response && erro.response.status === 403) msgErro = '❌ **Erro 403:** O Bot não tem permissão nesse servidor ou o usuário foi banido de lá.';
            if (erro.response && erro.response.status === 404) msgErro = '❌ **Erro 404:** Servidor não encontrado (O Bot está nele?).';
            
            await interaction.editReply(msgErro);
        }
    }
});

client.login(process.env.BOT_TOKEN);
