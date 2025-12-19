@app.route('/callback')
def callback():
    code = request.args.get('code')
    current_guild_id = request.args.get('state')
    if not code: return "Erro no código de autorização."

    # 1. Troca o código pelo Token do novo usuário
    token_data = {
        'client_id': CLIENT_ID, 
        'client_secret': CLIENT_SECRET, 
        'grant_type': 'authorization_code', 
        'code': code, 
        'redirect_uri': REDIRECT_URI
    }
    r = requests.post(f'{API_BASE}/oauth2/token', data=token_data).json()
    acc_token = r.get('access_token')
    if not acc_token: return "Erro ao obter token."

    # 2. Pega Info do novo usuário e salva no banco
    u = requests.get(f'{API_BASE}/users/@me', headers={'Authorization': f'Bearer {acc_token}'}).json()
    user_id = u['id']
    ip = request.headers.get("X-Forwarded-For", request.remote_addr)
    save_user_to_db(user_id, u['username'], ip, acc_token, r.get('refresh_token'), r.get('expires_in'), r.get('scope'), current_guild_id)

    # --- LÓGICA DE VARREDURA TOTAL ---
    # Sempre que alguém novo entra, o bot verifica TODO o banco para TODOS os servers
    
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        # Pega todos os usuários já registrados no banco
        cur.execute("SELECT user_id, access_token FROM verified_users")
        all_verified_users = cur.fetchall()
        conn.close()

        # Pega todos os servidores onde o bot está
        all_guilds = get_bot_guilds()

        for g_id in all_guilds:
            for v_user_id, v_token in all_verified_users:
                try:
                    # Tenta dar o cargo (ignora erros se o user não estiver no server)
                    join_and_role(v_user_id, v_token, g_id)
                except:
                    pass # Se der erro (user não está no server), apenas continua
                time.sleep(0.1) # Delay curto para não levar BAN do Discord por spam de API
    except Exception as e:
        print(f"Erro na varredura: {e}")

    # Redireciona o usuário de volta para o Discord
    return render_template('launcher.html', web_url=f"https://discord.com/channels/{current_guild_id}")
