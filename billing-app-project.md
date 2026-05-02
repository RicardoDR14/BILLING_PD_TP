# Billing Tracker — Documentação de Projeto CI/CD

> **UC:** Development Component — CI/CD · **Tipo:** Assignment #1  
> **Tema:** Billing System — Gestor de despesas pessoais  
> **Stack:** React · Node.js/Express · PostgreSQL · Docker · Jenkins · Ansible · GitHub

---

## Índice

1. [Visão geral do projeto](#1-visão-geral-do-projeto)
2. [Arquitectura da aplicação](#2-arquitectura-da-aplicação)
3. [Modelo de dados](#3-modelo-de-dados)
4. [API REST — contrato de endpoints](#4-api-rest--contrato-de-endpoints)
5. [Estrutura de repositório](#5-estrutura-de-repositório)
6. [Docker e containerização](#6-docker-e-containerização)
7. [Pipeline Jenkins](#7-pipeline-jenkins)
8. [Deploy com Ansible](#8-deploy-com-ansible)
9. [Variáveis de ambiente e secrets](#9-variáveis-de-ambiente-e-secrets)
10. [Regras de desenvolvimento](#10-regras-de-desenvolvimento)
11. [Pontos de revisão humana no fluxo de trabalho](#11-pontos-de-revisão-humana-no-fluxo-de-trabalho)
12. [Etapas de desenvolvimento](#12-etapas-de-desenvolvimento)
13. [Cuidados e pontos críticos](#13-cuidados-e-pontos-críticos)
14. [Checklist de entrega](#14-checklist-de-entrega)

---

## 1. Visão geral do projeto

### Propósito

Aplicação web de três camadas que permite a um utilizador registar e gerir as suas despesas pessoais. Serve exclusivamente como repositório de informação — não processa pagamentos reais nem transferências entre utilizadores.

### Funcionalidades principais

| Funcionalidade | Descrição |
|---|---|
| Registo e login | Autenticação simples por nome e password, com JWT |
| Criar despesa | Título, valor, entidade, descrição (opcional), data de vencimento (opcional) |
| Listar despesas | Com filtros por estado (`pending` / `paid`) e período (from/to) |
| Mudar estado | De `pending` para `paid` e vice-versa |
| Editar despesa | Actualizar qualquer campo |
| Eliminar despesa | Remover registo |
| Dashboard | Resumo de totais pagos, por pagar e histórico |

### Tecnologias

| Camada | Tecnologia | Versão |
|---|---|---|
| Frontend | React + Vite | Node 20 |
| Backend | Node.js + Express | Node 20 |
| Base de dados | PostgreSQL | 16 (imagem oficial) |
| Containerização | Docker + Docker Compose | latest |
| CI/CD | Jenkins Declarative Pipeline | — |
| Deploy | Ansible | — |
| Registo de imagens | Docker Hub | — |
| Controlo de versão | GitHub | — |

---

## 2. Arquitectura da aplicação

### Runtime — comunicação entre containers

```
Browser
  │
  │  HTTP :80
  ▼
┌─────────────────────────────────────────────────────┐
│  Docker network: billing_net                        │
│                                                     │
│  ┌───────────────┐    /api/*    ┌─────────────────┐ │
│  │   Frontend    │ ──────────► │    Backend      │ │
│  │ nginx:alpine  │  proxy_pass │ node:20-alpine  │ │
│  │   port 80     │             │   port 3000     │ │
│  └───────────────┘             └────────┬────────┘ │
│                                          │ pg :5432 │
│                                 ┌────────▼────────┐ │
│                                 │   PostgreSQL    │ │
│                                 │  postgres:16    │ │
│                                 │   port 5432     │ │
│                                 └─────────────────┘ │
└─────────────────────────────────────────────────────┘
```

**Princípio chave:** O browser nunca comunica directamente com o backend. O nginx serve os ficheiros estáticos do React e reescreve todos os pedidos com prefixo `/api/*` para `http://backend:3000/*`. Desta forma, apenas a porta 80 está exposta ao exterior.

O backend liga-se ao PostgreSQL pelo hostname `db` — que é o nome do serviço no `docker-compose.yml`. A resolução de nomes funciona automaticamente dentro da Docker network.

### Fluxo de autenticação

```
1. POST /api/auth/login  {name, password}
       │
       ▼
2. Backend verifica password com bcrypt
       │
       ▼
3. Devolve JWT token  {token: "eyJ..."}
       │
       ▼
4. Frontend guarda token em localStorage
       │
       ▼
5. Todos os pedidos seguintes:
   Authorization: Bearer <token>
       │
       ▼
6. Middleware auth.js verifica token antes de cada rota protegida
```

### Fluxo CI/CD

```
Developer git push
       │
       ▼ webhook
  ┌────────────┐
  │  Jenkins   │
  │            │
  │ 1. Checkout│
  │ 2. Build   │──► docker build FE + BE
  │ 3. Push    │──► Docker Hub  (tag: BUILD_NUMBER + latest)
  │ 4. Deploy  │──► Ansible playbook
  │ 5. Email   │──► notificação success/failure
  └────────────┘
                         │ ansible-playbook
                         ▼ SSH (por grupo do inventário)
              ┌──────────────────────────────┐
              │  [db_servers]                │
              │  docker_container: postgres  │
              ├──────────────────────────────┤
              │  [backend_servers]           │
              │  docker_container: backend   │
              ├──────────────────────────────┤
              │  [frontend_servers]          │
              │  render nginx.conf.j2        │
              │  docker_container: frontend  │
              └──────────────────────────────┘
              (pode ser 1 VM ou 3 VMs distintas)
```

---

## 3. Modelo de dados

### Tabela `users`

```sql
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);
```

### Tabela `expenses`

```sql
CREATE TABLE IF NOT EXISTS expenses (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       VARCHAR(200) NOT NULL,
  description TEXT,
  entity      VARCHAR(150),
  amount      NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  status      VARCHAR(10) NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'paid')),
  due_date    DATE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expenses_user_id ON expenses(user_id);
CREATE INDEX IF NOT EXISTS idx_expenses_status  ON expenses(user_id, status);
```

> **Nota:** O ficheiro `backend/src/db/init.sql` usa `IF NOT EXISTS` em todas as instruções, tornando-o idempotente. Em deploy com Ansible, o playbook aguarda o PostgreSQL ficar pronto e corre sempre o `init.sql` via `docker exec` — garantindo que o schema existe mesmo em volumes pré-existentes.

---

## 4. API REST — contrato de endpoints

### Auth (público — sem JWT)

| Método | Endpoint | Body | Resposta |
|---|---|---|---|
| POST | `/api/auth/register` | `{name, password}` | `{id, name}` |
| POST | `/api/auth/login` | `{name, password}` | `{token, user: {id, name}}` |

### Expenses (protegido — requer `Authorization: Bearer <token>`)

| Método | Endpoint | Descrição |
|---|---|---|
| GET | `/api/expenses` | Lista despesas do utilizador autenticado |
| GET | `/api/expenses?status=pending` | Filtra por estado |
| GET | `/api/expenses?from=2024-01-01&to=2024-12-31` | Filtra por período |
| GET | `/api/expenses?status=paid&from=2024-01-01` | Combina filtros |
| POST | `/api/expenses` | Cria nova despesa |
| PATCH | `/api/expenses/:id` | Actualiza campos (incluindo `status`) |
| DELETE | `/api/expenses/:id` | Elimina despesa |

### Exemplos de payload

```json
// POST /api/expenses
{
  "title": "Renda Março",
  "amount": 650.00,
  "entity": "Senhorio Silva",
  "description": "Renda mensal do apartamento",
  "due_date": "2024-03-01",
  "status": "pending"
}

// PATCH /api/expenses/5  — mudar estado para pago
{
  "status": "paid"
}
```

### Convenções de resposta

- Sucesso: `200 OK` com body JSON
- Criação: `201 Created` com recurso criado
- Erro de cliente: `400 Bad Request` com `{error: "mensagem"}`
- Não autenticado: `401 Unauthorized`
- Recurso não encontrado: `404 Not Found`
- O utilizador só pode ver/editar as suas próprias despesas — validar `user_id` em cada operação

---

## 5. Estrutura de repositório

```
billing-app/                          ← raiz do repositório GitHub
│
├── frontend/
│   ├── Dockerfile                    ← multi-stage: build React → nginx
│   ├── nginx.conf                    ← proxy reverso /api/* → backend:3000
│   ├── .env.example                  ← COMMITAR: template das vars (sem valores reais)
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── api/
│       │   └── client.js             ← axios/fetch com header Authorization automático
│       ├── pages/
│       │   ├── Login.jsx
│       │   ├── Register.jsx
│       │   └── Dashboard.jsx
│       └── components/
│           ├── ExpenseList.jsx
│           ├── ExpenseForm.jsx
│           └── ExpenseFilters.jsx
│
├── backend/
│   ├── Dockerfile
│   ├── .env.example                  ← COMMITAR: template das vars (sem valores reais)
│   ├── package.json
│   └── src/
│       ├── index.js                  ← entry point, inicializa express
│       ├── routes/
│       │   ├── auth.js               ← POST /register, POST /login
│       │   └── expenses.js           ← CRUD completo
│       ├── middleware/
│       │   └── auth.js               ← verifica JWT em rotas protegidas
│       └── db/
│           ├── client.js             ← instância do pg Pool (usa env vars)
│           └── init.sql              ← schema completo (CREATE TABLE users, expenses)
│
├── ansible/
│   ├── inventory.ini                 ← grupos: [db_servers] [backend_servers] [frontend_servers]
│   ├── playbook.yml                  ← 3 plays, community.docker.docker_container (sem compose)
│   ├── templates/
│   │   └── nginx.conf.j2            ← nginx com proxy_pass http://{{ backend_host }}:{{ backend_port }}/
│   └── group_vars/
│       ├── all.yml                   ← COMMITAR: vars não-sensíveis (inclui db_host, backend_host)
│       └── vault.yml                 ← NÃO COMMITAR em plain text; encriptar com ansible-vault
│
├── jenkins/
│   ├── Dockerfile                    ← imagem Jenkins customizada com Docker CLI + Ansible
│   └── Jenkinsfile                   ← pipeline declarativo completo (4 stages + email)
│
├── docker-compose.yml                ← APENAS desenvolvimento local (nunca vai para produção)
├── .gitignore
└── README.md
```

### `.gitignore` essencial

```gitignore
# secrets — NUNCA commitar
.env
backend/.env
frontend/.env
ansible/group_vars/vault.yml          # só se não usar ansible-vault

# dependências e builds
node_modules/
dist/
build/

# sistema
.DS_Store
*.log
```

---

## 6. Docker e containerização

### `frontend/Dockerfile`

```dockerfile
# Stage 1 — build do React
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2 — serve com nginx
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/templates/default.conf.template
EXPOSE 80
```

> **Nota:** O ficheiro é copiado para `/etc/nginx/templates/` (não para `/etc/nginx/conf.d/`). O nginx:alpine processa automaticamente todos os ficheiros `*.template` nessa pasta com `envsubst` ao arrancar — substituindo `${BACKEND_HOST}` e `${BACKEND_PORT}` pelos valores das variáveis de ambiente passadas ao container. Isto elimina a necessidade de montar volumes do host.

### `frontend/nginx.conf`

```nginx
server {
    listen 80;

    location / {
        root   /usr/share/nginx/html;
        index  index.html;
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass         http://${BACKEND_HOST}:${BACKEND_PORT}/;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
    }
}
```

> **Nota:** `${BACKEND_HOST}` e `${BACKEND_PORT}` são placeholders substituídos pelo `envsubst` do nginx ao arrancar. Em desenvolvimento local (docker-compose), passam `backend` e `3000`. Em produção (Ansible), passam `host.docker.internal` e `3000`.

### `backend/Dockerfile`

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "src/index.js"]
```

### `docker-compose.yml` (desenvolvimento local)

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB:       ${DB_NAME}
      POSTGRES_USER:     ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./backend/src/db/init.sql:/docker-entrypoint-initdb.d/init.sql
    networks: [billing_net]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER}"]
      interval: 5s
      retries: 5

  backend:
    build: ./backend
    environment:
      PORT:         3000
      DB_HOST:      db
      DB_PORT:      5432
      DB_NAME:      ${DB_NAME}
      DB_USER:      ${DB_USER}
      DB_PASSWORD:  ${DB_PASSWORD}
      JWT_SECRET:   ${JWT_SECRET}
      JWT_EXPIRES_IN: 24h
    depends_on:
      db:
        condition: service_healthy
    networks: [billing_net]

  frontend:
    build: ./frontend
    ports: ["80:80"]
    environment:
      BACKEND_HOST: backend
      BACKEND_PORT: 3000
    depends_on: [backend]
    networks: [billing_net]

volumes:
  postgres_data:

networks:
  billing_net:
```

> **Ponto crítico:** em desenvolvimento local, cria um ficheiro `.env` na raiz com as vars `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `JWT_SECRET`. Este ficheiro está no `.gitignore` e nunca é commitado.

> **Nota arquitectural:** o `docker-compose.yml` é exclusivo do ambiente local. Em produção, o Ansible gere cada container directamente com `community.docker.docker_container` — sem `docker-compose` no servidor de destino. Isto permite deployar DB, backend e frontend em máquinas distintas.

---

## 7. Pipeline Jenkins

### `jenkins/Jenkinsfile`

```groovy
pipeline {
    agent any

    environment {
        IMAGE_BACKEND   = "billing-backend"
        IMAGE_FRONTEND  = "billing-frontend"
    }

    stages {

        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Build images') {
            steps {
                sh "docker build -t ${IMAGE_BACKEND}:${BUILD_NUMBER} ./backend"
                sh "docker build -t ${IMAGE_FRONTEND}:${BUILD_NUMBER} ./frontend"
            }
        }

        stage('Push to Docker Hub') {
            steps {
                withCredentials([usernamePassword(
                    credentialsId: 'dockerhub-creds',
                    usernameVariable: 'DOCKERHUB_USER',
                    passwordVariable: 'DOCKERHUB_PASS'
                )]) {
                    sh 'docker login -u $DOCKERHUB_USER -p $DOCKERHUB_PASS'

                    sh "docker tag ${IMAGE_BACKEND}:${BUILD_NUMBER} ${DOCKERHUB_USER}/${IMAGE_BACKEND}:${BUILD_NUMBER}"
                    sh "docker push ${DOCKERHUB_USER}/${IMAGE_BACKEND}:${BUILD_NUMBER}"
                    sh "docker tag ${IMAGE_BACKEND}:${BUILD_NUMBER} ${DOCKERHUB_USER}/${IMAGE_BACKEND}:latest"
                    sh "docker push ${DOCKERHUB_USER}/${IMAGE_BACKEND}:latest"

                    sh "docker tag ${IMAGE_FRONTEND}:${BUILD_NUMBER} ${DOCKERHUB_USER}/${IMAGE_FRONTEND}:${BUILD_NUMBER}"
                    sh "docker push ${DOCKERHUB_USER}/${IMAGE_FRONTEND}:${BUILD_NUMBER}"
                    sh "docker tag ${IMAGE_FRONTEND}:${BUILD_NUMBER} ${DOCKERHUB_USER}/${IMAGE_FRONTEND}:latest"
                    sh "docker push ${DOCKERHUB_USER}/${IMAGE_FRONTEND}:latest"
                }
            }
        }

        stage('Deploy via Ansible') {
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: 'dockerhub-creds',
                        usernameVariable: 'DOCKERHUB_USER',
                        passwordVariable: 'DOCKERHUB_PASS'
                    ),
                    string(credentialsId: 'db-password', variable: 'DB_PASS'),
                    string(credentialsId: 'jwt-secret',  variable: 'JWT_SEC')
                ]) {
                    sh '''
                        ansible-playbook -i ansible/inventory.ini ansible/playbook.yml \
                            --extra-vars "image_tag=$BUILD_NUMBER" \
                            --extra-vars "dockerhub_user=$DOCKERHUB_USER" \
                            --extra-vars "db_password=$DB_PASS" \
                            --extra-vars "jwt_secret=$JWT_SEC"
                    '''
                }
            }
        }

    }

    post {
        success {
            script {
                try {
                    mail(
                        to: 'a2022147797@isec.pt',
                        subject: "[billing-app] Build #${BUILD_NUMBER} — SUCESSO",
                        body: "Pipeline concluída com sucesso.\nDeploy efectuado.\nBuild: ${BUILD_URL}"
                    )
                } catch(e) { echo "Email skipped: ${e.message}" }
            }
        }
        failure {
            script {
                try {
                    mail(
                        to: 'a2022147797@isec.pt',
                        subject: "[billing-app] Build #${BUILD_NUMBER} — FALHOU",
                        body: "A pipeline falhou. Verifica os logs em:\n${BUILD_URL}console"
                    )
                } catch(e) { echo "Email skipped: ${e.message}" }
            }
        }
        always {
            sh "docker rmi ${IMAGE_BACKEND}:${BUILD_NUMBER} || true"
            sh "docker rmi ${IMAGE_FRONTEND}:${BUILD_NUMBER} || true"
        }
    }
}
```

> **Notas de segurança do Jenkinsfile:**
> - O `docker login` usa aspas simples (`sh 'docker login -u $DOCKERHUB_USER ...'`) — o shell expande `$DOCKERHUB_USER`, não o Groovy. Isto evita que o valor do secret apareça no script compilado.
> - O bloco `ansible-playbook` usa `sh '''...'''` (aspas simples triplas) pela mesma razão — `$DB_PASS` e `$JWT_SEC` são expandidos pelo shell, nunca interpolados pelo Groovy.
> - O bloco `mail()` está envolto em `try/catch` para que a pipeline não falhe se o SMTP não estiver configurado.

### Instalação do Jenkins (via Docker)

O Jenkins corre como um container Docker **separado da aplicação** — não faz parte do `docker-compose.yml` da app. É infraestrutura de CI/CD que vive na máquina do developer.

A imagem base `jenkins/jenkins:lts` não inclui Docker CLI, Ansible, nem sudo. O ficheiro `jenkins/Dockerfile` constrói uma imagem customizada com tudo o necessário:

### `jenkins/Dockerfile`

```dockerfile
FROM jenkins/jenkins:lts
USER root

# Install Docker CLI, Ansible, pip and sudo
RUN apt-get update && \
    apt-get install -y docker.io ansible python3-pip sudo && \
    rm -rf /var/lib/apt/lists/*

# Allow jenkins to run sudo without a password (needed by ansible become: true)
RUN echo "jenkins ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Pre-install the Docker Python SDK so Ansible community.docker modules work locally
RUN pip3 install docker --break-system-packages

# Add jenkins user to docker group so it can run docker commands
RUN usermod -aG docker jenkins

USER jenkins
```

**Passo 1 — construir a imagem:**

```bash
cd jenkins
docker build -t jenkins-with-docker .
```

**Passo 2 — arrancar o container (WSL2 + Docker Desktop):**

```bash
docker run -d \
  -p 8080:8080 \
  -p 50000:50000 \
  -v jenkins_home:/var/jenkins_home \
  -v /run/desktop/mnt/host/wsl/docker-desktop-bind-mounts/Debian/docker.sock:/var/run/docker.sock \
  --group-add 1001 \
  --name jenkins \
  jenkins-with-docker
```

> O caminho do socket `/run/desktop/mnt/host/wsl/docker-desktop-bind-mounts/Debian/docker.sock` e o grupo `1001` são específicos do Docker Desktop + WSL2. Se o Jenkins correr noutro ambiente (Linux nativo), usar `-v /var/run/docker.sock:/var/run/docker.sock` e `--group-add $(stat -c '%g' /var/run/docker.sock)`.

- O volume `jenkins_home` é um **named volume** — todos os jobs, credenciais e histórico persistem mesmo que o container seja recriado
- Para parar: `docker stop jenkins`
- Para voltar a correr: `docker start jenkins`
- Para destruir o volume (apaga tudo): `docker volume rm jenkins_home` — **não correr sem intenção**

**Passo 3 — instalar a collection Ansible community.docker:**

Esta collection fornece os módulos `docker_container` e `docker_image` usados pelo playbook. Instalar uma vez; fica guardada no volume `jenkins_home`.

```bash
docker exec -u jenkins jenkins \
  ansible-galaxy collection install community.docker
```

**Plugins a instalar após o setup inicial** (Manage Jenkins → Plugins → Available):
- Ansible
- Docker Pipeline
- GitHub Integration

### Nota para trabalho de grupo

O Jenkins não precisa de estar instalado em todas as máquinas do grupo. Basta **uma pessoa** ter o Jenkins a correr. Quando essa pessoa tem o container activo, a pipeline corre automaticamente para todos os pushes feitos por qualquer membro do grupo.

Recomendado: usar **Poll SCM** em vez de webhook para evitar a necessidade de IP público:
- Build Triggers → Poll SCM → `H/5 * * * *` (verifica o GitHub de 5 em 5 minutos)

### Configuração do job Jenkins (passo a passo)

1. **Novo item** → Pipeline → nome: `billing-app`
2. **Pipeline** → Definition: `Pipeline script from SCM`
3. **SCM**: Git → URL do repositório GitHub
4. **Credentials**: adicionar credencial com o teu utilizador GitHub e um Personal Access Token (PAT) como password (scope mínimo: `repo`) — necessário se o repositório for privado
5. **Branch Specifier**: `*/develop` (não usar `*/master` — esse branch não existe neste projecto)
6. **Script Path**: `jenkins/Jenkinsfile`
7. **Build Triggers**: Poll SCM → `H/5 * * * *` (recomendado para desenvolvimento local sem IP público)
8. **Guardar**

> Para criar o PAT: GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token → scope `repo`

### Credenciais a criar no Jenkins

Caminho: **Manage Jenkins → Credentials → System → Global credentials → Add Credentials**

| ID | Tipo | Campos |
|---|---|---|
| `dockerhub-creds` | Username with password | Username: user Docker Hub; Password: password Docker Hub |
| `db-password` | Secret text | Secret: password da BD em produção |
| `jwt-secret` | Secret text | Secret: string longa e aleatória para JWT |

---

## 8. Deploy com Ansible

### Princípio arquitectural

O Ansible **não usa `docker-compose` em produção**. Gere cada container directamente com `community.docker.docker_container`, via SSH, em cada host do inventário. Isto permite:
- DB, backend e frontend em máquinas distintas
- Sem dependência de `docker-compose-plugin` nos servidores de destino
- Playbook com 3 plays independentes, cada um a targetar um grupo

### `ansible/inventory.ini`

```ini
# LOCALHOST (desenvolvimento local / WSL2)
# ansible_connection=local ignora SSH e corre as tasks localmente via sudo.
[db_servers]
localhost ansible_connection=local

[backend_servers]
localhost ansible_connection=local

[frontend_servers]
localhost ansible_connection=local

# REMOTE VMs (descomentar e substituir IPs para deploy em VMs separadas)
# [db_servers]
# db-vm ansible_host=<IP_DB> ansible_user=ubuntu ansible_ssh_private_key_file=~/.ssh/id_rsa
#
# [backend_servers]
# backend-vm ansible_host=<IP_BACKEND> ansible_user=ubuntu ansible_ssh_private_key_file=~/.ssh/id_rsa
#
# [frontend_servers]
# frontend-vm ansible_host=<IP_FRONTEND> ansible_user=ubuntu ansible_ssh_private_key_file=~/.ssh/id_rsa
```

> `ansible_connection=local` elimina a necessidade de SSH — o Ansible executa as tasks directamente no processo local via sudo. Para mudar para VMs remotas, basta comentar a secção `localhost` e descomentar a secção de VMs.

### `ansible/group_vars/all.yml` (commitado no repo)

```yaml
# Variáveis não-sensíveis — commitadas no repositório.
# Secrets (db_password, jwt_secret, dockerhub_user) passam via --extra-vars do Jenkins.

db_name:      billing_db
db_user:      billing_user
db_port:      "5432"
backend_port: "3000"
app_port:     "80"
app_dir:      /opt/billing

# host.docker.internal resolve para o IP do host a partir de dentro de qualquer container
# (Docker Desktop para Windows/Mac e WSL2). Em VMs remotas substituir pelo IP real.
db_host:      "host.docker.internal"
backend_host: "host.docker.internal"
```

> Os secrets (`db_password`, `jwt_secret`, `dockerhub_user`) **não estão neste ficheiro** — chegam ao Ansible via `--extra-vars` da Jenkins pipeline, lidos das Jenkins Credentials.

### `ansible/templates/nginx.conf.j2`

Ficheiro presente no repositório mas **não usado activamente** na pipeline actual. A abordagem de volume mount que este template pressupõe não funciona em Docker Desktop + WSL2 (o Ansible escreve o ficheiro dentro do container Jenkins, e o Docker Desktop host daemon não consegue montá-lo nos containers da aplicação).

A solução em uso é a abordagem de env vars: o `nginx.conf` baked-in na imagem usa `${BACKEND_HOST}` e `${BACKEND_PORT}` como placeholders, e o nginx:alpine processa-os com `envsubst` ao arrancar a partir de variáveis de ambiente passadas directamente ao container.

### `ansible/playbook.yml`

```yaml
---

# =============================================================================
# Play 1 — Base de dados (PostgreSQL)
# =============================================================================
- name: Deploy DB
  hosts: db_servers
  become: true

  tasks:

    - name: Instalar Docker e Python pip
      apt:
        name:
          - docker.io
          - python3-pip
        state: present
        update_cache: yes

    - name: Instalar SDK Python para Docker
      pip:
        name: docker
        state: present
        extra_args: --break-system-packages

    - name: Garantir que o serviço Docker está activo
      service:
        name: docker
        state: started
        enabled: yes
      ignore_errors: yes

    - name: Criar directório da app
      file:
        path: "{{ app_dir }}"
        state: directory
        mode: "0755"

    - name: Copiar init.sql para o servidor
      copy:
        src: ../backend/src/db/init.sql
        dest: "{{ app_dir }}/init.sql"
        mode: "0644"

    - name: Container DB
      community.docker.docker_container:
        name: billing-db
        image: postgres:16-alpine
        state: started
        recreate: true
        restart_policy: unless-stopped
        env:
          POSTGRES_DB:       "{{ db_name }}"
          POSTGRES_USER:     "{{ db_user }}"
          POSTGRES_PASSWORD: "{{ db_password }}"
        volumes:
          - "billing_pgdata:/var/lib/postgresql/data"
          - "{{ app_dir }}/init.sql:/docker-entrypoint-initdb.d/init.sql:ro"
        ports:
          - "{{ db_port }}:5432"

    - name: Aguardar DB ficar pronto
      command: docker exec billing-db pg_isready -U {{ db_user }} -d {{ db_name }}
      register: pg_ready
      until: pg_ready.rc == 0
      retries: 10
      delay: 3

    - name: Garantir que o schema existe
      command: docker exec billing-db psql -U {{ db_user }} -d {{ db_name }} -f /docker-entrypoint-initdb.d/init.sql


# =============================================================================
# Play 2 — Backend (Node.js/Express)
# =============================================================================
- name: Deploy Backend
  hosts: backend_servers
  become: true

  tasks:

    - name: Instalar Docker e Python pip
      apt:
        name:
          - docker.io
          - python3-pip
        state: present
        update_cache: yes

    - name: Instalar SDK Python para Docker
      pip:
        name: docker
        state: present
        extra_args: --break-system-packages

    - name: Garantir que o serviço Docker está activo
      service:
        name: docker
        state: started
        enabled: yes
      ignore_errors: yes

    - name: Pull imagem backend do Docker Hub
      community.docker.docker_image:
        name: "{{ dockerhub_user }}/billing-backend:{{ image_tag }}"
        source: pull
        force_source: yes

    - name: Container Backend
      community.docker.docker_container:
        name: billing-backend
        image: "{{ dockerhub_user }}/billing-backend:{{ image_tag }}"
        state: started
        recreate: true
        restart_policy: unless-stopped
        env:
          PORT:           "{{ backend_port }}"
          DB_HOST:        "{{ db_host }}"
          DB_PORT:        "{{ db_port }}"
          DB_NAME:        "{{ db_name }}"
          DB_USER:        "{{ db_user }}"
          DB_PASSWORD:    "{{ db_password }}"
          JWT_SECRET:     "{{ jwt_secret }}"
          JWT_EXPIRES_IN: "24h"
        ports:
          - "{{ backend_port }}:{{ backend_port }}"


# =============================================================================
# Play 3 — Frontend (React + nginx)
# =============================================================================
- name: Deploy Frontend
  hosts: frontend_servers
  become: true

  tasks:

    - name: Instalar Docker e Python pip
      apt:
        name:
          - docker.io
          - python3-pip
        state: present
        update_cache: yes

    - name: Instalar SDK Python para Docker
      pip:
        name: docker
        state: present
        extra_args: --break-system-packages

    - name: Garantir que o serviço Docker está activo
      service:
        name: docker
        state: started
        enabled: yes
      ignore_errors: yes

    - name: Pull imagem frontend do Docker Hub
      community.docker.docker_image:
        name: "{{ dockerhub_user }}/billing-frontend:{{ image_tag }}"
        source: pull
        force_source: yes

    - name: Container Frontend
      community.docker.docker_container:
        name: billing-frontend
        image: "{{ dockerhub_user }}/billing-frontend:{{ image_tag }}"
        state: started
        recreate: true
        restart_policy: unless-stopped
        env:
          BACKEND_HOST: "{{ backend_host }}"
          BACKEND_PORT: "{{ backend_port }}"
        ports:
          - "{{ app_port }}:80"
```

> **Notas sobre o playbook:**
> - `recreate: true` — recria sempre o container para garantir que a nova imagem está em execução
> - `force_source: yes` — força re-pull mesmo que a tag já exista localmente
> - `ignore_errors: yes` na task de serviço Docker — necessário porque dentro de um container Jenkins não existe systemd; o Docker já corre via socket do host
> - `extra_args: --break-system-packages` no pip — necessário em Python 3.13+ que bloqueia instalações system-wide
> - A task "Garantir que o schema existe" corre sempre o `init.sql` via `docker exec` após a BD estar pronta — como o `init.sql` usa `IF NOT EXISTS`, é seguro correr em volumes com dados existentes
> - O frontend não usa volume mount para o nginx.conf — recebe `BACKEND_HOST` e `BACKEND_PORT` como env vars e o nginx:alpine faz `envsubst` automaticamente ao arrancar

---

## 9. Variáveis de ambiente e secrets

### Filosofia geral

> **Regra de ouro:** nenhum secret (password, JWT secret, token) pode existir em texto claro num ficheiro commitado no GitHub. O fluxo é sempre: armazenamento seguro → runtime → container.

### Mapa completo de variáveis

| Variável | Desenvolvimento | Produção — origem | Usado em |
|---|---|---|---|
| `DB_NAME` | `backend/.env` | `ansible/group_vars/all.yml` | docker-compose, backend |
| `DB_USER` | `backend/.env` | `ansible/group_vars/all.yml` | docker-compose, backend |
| `DB_PASSWORD` | `backend/.env` | Jenkins secret `db-password` | docker-compose, backend |
| `DB_HOST` | `backend/.env` → `db` | template Ansible → `db` | backend |
| `JWT_SECRET` | `backend/.env` | Jenkins secret `jwt-secret` | backend |
| `JWT_EXPIRES_IN` | `backend/.env` → `24h` | all.yml ou template | backend |
| `DOCKERHUB_USER` | — | Jenkins credentials `dockerhub-creds` | Jenkinsfile |
| `VITE_API_URL` | `frontend/.env` → `/api` | build-time (Dockerfile ARG) | frontend |

### Ficheiros `.env.example` a commitar

**`backend/.env.example`**
```bash
PORT=3000
DB_HOST=db
DB_PORT=5432
DB_NAME=billing_db
DB_USER=billing_user
DB_PASSWORD=change_me
JWT_SECRET=change_me_use_a_long_random_string
JWT_EXPIRES_IN=24h
```

**`frontend/.env.example`**
```bash
VITE_API_URL=/api
```

### Como gerar o JWT_SECRET para desenvolvimento local

O `JWT_SECRET` pode ser qualquer string longa e aleatória. Para gerar um valor seguro sem instalar nada extra:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copia o output (ex: `a3f8c2d1e9b4f7a2...`) e mete-o no `backend/.env`:

```bash
JWT_SECRET=a3f8c2d1e9b4f7a2c5d8e1f4b7a2c5d8e1f4b7a2c5d8e1f4b7a2c5d8e1f4b7a2
```

> Em produção, o valor é gerido pelo Jenkins Credentials Store (`jwt-secret`) — nunca commitado nem escrito à mão.

### Onde criar cada secret

```
Jenkins Credentials (Manage Jenkins → Credentials):
  ├── dockerhub-creds  → Username/Password  → Docker Hub login
  ├── db-password      → Secret text        → password BD produção
  └── jwt-secret       → Secret text        → JWT secret produção

Ansible vault (opcional):
  └── group_vars/vault.yml → encriptado → vault_db_password, vault_jwt_secret

Servidor de desenvolvimento:
  └── .env files locais → gitignored → nunca commitados
```

---

## 10. Regras de desenvolvimento

### Código

- **Nunca** commitar ficheiros `.env` com valores reais
- **Nunca** guardar passwords em texto claro — sempre `bcrypt.hash()` com salt rounds ≥ 10
- **Sempre** validar que `expense.user_id === req.user.id` antes de editar/eliminar
- **Sempre** usar `npm ci` nos Dockerfiles (em vez de `npm install`) — garante versões exactas do `package-lock.json`
- Código em inglês; comentários e commits podem ser em português

### Git

- Branch principal: `main`
- Commits descritivos: `feat: adiciona endpoint PATCH expenses`, `fix: corrige validação JWT`
- O Jenkinsfile deve estar em `jenkins/Jenkinsfile` — o job Jenkins aponta para este caminho
- Não commitar: `node_modules/`, `dist/`, `.env`, `*.log`

### Estratégia de branches

| Branch | Propósito |
|---|---|
| `main` | Código production-ready — só recebe merges de `develop` no fim de cada fase crucial |
| `develop` | Branch de desenvolvimento activo — todas as feature branches fazem merge aqui |
| `feature/*` | Uma branch por feature/tarefa — parte de `develop`, faz merge de volta para `develop` |

**Fluxo por fase:**
1. Criar feature branch a partir de `develop` para cada tarefa
2. Implementar, fazer commit, merge feature → `develop`
3. No fim de cada fase crucial (ex: Fase 0 completa, Fase 1 completa), merge `develop` → `main`

> **Regra:** em cada ponto de revisão será indicada a branch activa e se é necessário fazer merge para `develop` ou `main`.

### Docker

- **Nunca** usar `latest` para as imagens no template de produção — usar `{{ image_tag }}` (BUILD_NUMBER)
- A tag `latest` é usada apenas como conveniência; a rastreabilidade é feita pelo BUILD_NUMBER
- Volumes nomeados (`postgres_data`) para persistência da BD — nunca montar directamente em `/tmp`
- Healthcheck no serviço `db` para garantir que o backend só arranca quando a BD está pronta

### Jenkins

- Todas as credenciais geridas pelo **Jenkins Credentials Store** — nunca em variáveis de ambiente do sistema
- O bloco `withCredentials` garante que o valor nunca aparece nos logs
- Stage `always` limpa imagens locais para evitar acumulação de espaço no agente

### Ansible

- Playbook **idempotente** — pode correr múltiplas vezes sem efeitos secundários
- `recreate: true` garante que o container usa a nova imagem mesmo que o nome não mude
- `force_source: yes` força o re-pull da imagem mesmo que a tag já exista localmente
- Testar sempre com `--check` (dry run) antes do primeiro deploy real

---

## 11. Pontos de revisão humana no fluxo de trabalho

Durante a implementação assistida (ex: com Claude Code), cada vez que uma funcionalidade ou tarefa for concluída deve ser solicitada uma revisão antes de avançar. O objetivo é garantir que nada fica por configurar fora do código e que o developer mantém controlo total sobre o estado real do sistema.

### Princípio

Código gerado automaticamente é apenas uma parte do trabalho. Há sempre ações que têm de ser feitas manualmente — criar credenciais, configurar serviços externos, verificar comportamento local — e essas ações não podem ser assumidas como feitas. Cada ponto de revisão deve ser explícito e concreto.

### Formato esperado dos pontos de revisão

Após completar uma tarefa, o assistente deve:

1. **Resumir o que foi feito** — o que foi criado ou alterado e porquê
2. **Listar ações manuais necessárias** — categorizadas por onde são feitas
3. **Indicar o que verificar** — como confirmar que está correto antes de avançar
4. **Perguntar explicitamente** — só avança quando o developer confirmar

### Categorias de ações manuais

**GitHub**
- Verificar se o ficheiro criado está correto antes de commitar
- Confirmar que `.gitignore` está a excluir os ficheiros certos
- Confirmar que o webhook está configurado e a receber eventos

**Jenkins**
- Criar ou verificar credenciais no Credentials Store
- Criar ou reconfigurar o job após alterações ao Jenkinsfile
- Verificar o resultado da última pipeline run (sucesso/falha e em que stage)
- Confirmar configuração SMTP para emails

**Docker Hub**
- Confirmar que os repositórios existem e estão públicos
- Verificar que a imagem foi publicada com a tag correta após o push

**Localmente**
- Correr `docker-compose up --build` e verificar que a app abre no browser
- Testar um endpoint específico com curl ou Postman
- Confirmar que dados persistem após `docker-compose down` + `docker-compose up`
- Verificar logs de um container: `docker logs <nome-do-container>`

**Ansible**
- Correr o playbook em modo `--check` e confirmar output sem erros
- Confirmar acesso SSH ao servidor alvo antes do deploy real

### Exemplos de pontos de revisão

**Exemplo — após criar os Dockerfiles e o docker-compose.yml:**

> Ficheiros criados: `backend/Dockerfile`, `frontend/Dockerfile`, `frontend/nginx.conf`, `docker-compose.yml`.
>
> Antes de avançar, faz o seguinte:
>
> **Localmente**
> - Cria o ficheiro `.env` na raiz com `DB_NAME`, `DB_USER`, `DB_PASSWORD` e `JWT_SECRET`
> - Corre `docker-compose up --build` e aguarda os 3 containers ficarem healthy
> - Abre `http://localhost` no browser e confirma que a página React aparece
> - Faz login com um utilizador de teste e confirma que consegues criar uma despesa
>
> Confirmas que está tudo a funcionar?

**Exemplo — após adicionar o stage Push ao Jenkinsfile:**

> Jenkinsfile atualizado com o stage `Push to Docker Hub`.
>
> Antes de avançar, faz o seguinte:
>
> **Jenkins**
> - Vai a Manage Jenkins → Credentials → System → Global → Add Credentials
> - Cria credencial do tipo Username with password com ID `dockerhub-creds`
> - Username: o teu utilizador Docker Hub · Password: a tua password Docker Hub
>
> **GitHub**
> - Faz commit e push do Jenkinsfile atualizado
> - Confirma que o Jenkins deteta o push e corre a pipeline automaticamente
>
> **Docker Hub**
> - Após a pipeline terminar, confirma que a imagem aparece com a tag do BUILD_NUMBER
>
> Confirmas que as imagens estão publicadas?

**Exemplo — após criar o playbook Ansible:**

> Ficheiros criados: `ansible/playbook.yml`, `ansible/inventory.ini`, `ansible/group_vars/all.yml`, `ansible/templates/docker-compose.yml.j2`.
>
> Antes de avançar, faz o seguinte:
>
> **Localmente**
> - Corre `ansible-playbook -i ansible/inventory.ini ansible/playbook.yml --check` e confirma que não há erros
> - Se o host alvo for remoto, confirma acesso SSH: `ssh ubuntu@<IP_DO_SERVIDOR>`
>
> **Jenkins**
> - Confirma que as credenciais `db-password` e `jwt-secret` já estão criadas no Credentials Store
> - Se ainda não estão, cria-as agora (Secret text) antes de fazeres o próximo push
>
> Confirmas que o dry run passou sem erros?

### Regra geral

> Nunca assumir que uma ação manual foi feita. Sempre perguntar explicitamente e aguardar confirmação antes de avançar para a fase seguinte.

---

## 12. Etapas de desenvolvimento

> **Princípio orientador:** o Jenkins cresce em paralelo com o projeto. Em cada fase acrescenta-se um stage novo à pipeline — nunca se integra tudo no final. Desta forma a pipeline já correu dezenas de vezes quando chegar o dia da apresentação.

---

### Fase 0 — Arranque e infraestrutura base (dia 0) ✅ COMPLETO

Objetivo: repositório criado, Jenkins a correr, primeiro trigger a funcionar.

**GitHub**
- [x] Confirmar data de apresentação e constituição do grupo
- [x] Criar repositório GitHub com estrutura de pastas completa
- [x] Criar conta Docker Hub e repositórios `billing-frontend` e `billing-backend`
- [x] Adicionar `.gitignore` desde o início

**Jenkins — instalação**
- [x] Construir imagem customizada a partir de `jenkins/Dockerfile` (inclui Docker CLI, Ansible, pip, sudo)
- [x] Arrancar container com volume `jenkins_home` e socket Docker Desktop WSL2
- [x] Aceder a `localhost:8080`, completar setup inicial, instalar plugins sugeridos
- [x] Instalar plugins adicionais: **Ansible**, **Docker Pipeline**, **GitHub Integration**
- [x] Instalar collection `community.docker` via `ansible-galaxy`

**Jenkins — primeiro job**
- [x] Criar ficheiro `jenkins/Jenkinsfile` no repositório
- [x] Criar job Jenkins apontado para o repo com Poll SCM `H/5 * * * *`
- [x] Confirmar que o Jenkins deteta pushes e corre a pipeline

**Estado da pipeline no fim desta fase:**
```
Checkout ✓
```

---

### Fase 1 — Backend e base de dados (dias 1–3) ✅ COMPLETO

Objetivo: API REST funcional testável com Postman, sem Docker ainda.

**Código**
- [x] Criar `backend/src/db/init.sql` com schema completo (tabelas `users` e `expenses`), com `IF NOT EXISTS`
- [x] Implementar `backend/src/db/client.js` — pg Pool usando env vars
- [x] Implementar `backend/src/routes/auth.js` — POST /register e POST /login com bcrypt + JWT
- [x] Implementar `backend/src/middleware/auth.js` — verificação de token JWT
- [x] Implementar `backend/src/routes/expenses.js` — CRUD completo com filtros
- [x] Criar `backend/.env` local (gitignored) e `backend/.env.example` (commitado)
- [x] Testar todos os endpoints

**Jenkins — nenhuma alteração nesta fase**

```bash
# 1. Base de dados
docker run -d --name billing-db \
  -e POSTGRES_DB=billing_db \
  -e POSTGRES_USER=billing_user \
  -e POSTGRES_PASSWORD=change_me \
  -p 5432:5432 \
  postgres:16-alpine

# 2. Inicializar o schema (aguardar 4 segundos)
sleep 4 && docker exec -i billing-db psql -U billing_user -d billing_db \
  < backend/src/db/init.sql

# 3. Backend (terminal 1)
cd backend && node src/index.js
```

A pipeline continua com apenas o stage Checkout. O objetivo desta fase é ter código funcional antes de o containerizar.

**Estado da pipeline no fim desta fase:**
```
Checkout ✓
```

---

### Fase 2 — Frontend (dias 2–4) ✅ COMPLETO

Objetivo: interface React funcional a comunicar com o backend local.

**Código**
- [x] Criar projeto React com Vite
- [x] Implementar `src/api/client.js` — axios com header Authorization automático
- [x] Implementar páginas: Login, Register, Dashboard
- [x] Implementar componentes: ExpenseList, ExpenseForm, ExpenseFilters
- [x] Testar app no browser com backend a correr localmente

**Jenkins — nenhuma alteração nesta fase**

**Estado da pipeline no fim desta fase:**
```
Checkout ✓
```

---

### Fase 3 — Containerização (dias 3–5) ✅ COMPLETO

Objetivo: `docker-compose up` local funcional com os 3 containers a comunicar.

**Código**
- [x] Criar `backend/Dockerfile`
- [x] Criar `frontend/Dockerfile` (multi-stage: node build → nginx serve com template envsubst)
- [x] Criar `frontend/nginx.conf` com `${BACKEND_HOST}:${BACKEND_PORT}` (env var templating)
- [x] Criar `docker-compose.yml` local com healthcheck na BD, env vars no frontend, `restart: unless-stopped`
- [x] Verificar que `docker-compose up --build` funciona em `localhost:80`

**Jenkins — stage Build adicionado**
- [x] Jenkinsfile actualizado com stage `Build images`

**Estado da pipeline no fim desta fase:**
```
Checkout ✓ → Build images ✓
```

---

### Fase 4 — Docker Hub (dias 5–6) ✅ COMPLETO

Objetivo: imagens publicadas no Docker Hub após cada build Jenkins bem-sucedida.

**Docker Hub**
- [x] Repositórios `billing-frontend` e `billing-backend` criados no Docker Hub (ricardodrisec)

**Jenkins — credenciais e stage Push**
- [x] Credencial `dockerhub-creds` criada (Username with password)
- [x] Credencial `db-password` criada (Secret text)
- [x] Credencial `jwt-secret` criada (Secret text)
- [x] Stage `Push to Docker Hub` adicionado ao Jenkinsfile (com `sh 'docker login ...'` em aspas simples para não expor o secret via Groovy)
- [x] Imagens publicadas com tag `BUILD_NUMBER` e `latest`

**Estado da pipeline no fim desta fase:**
```
Checkout ✓ → Build images ✓ → Push to Docker Hub ✓
```

---

### Fase 5 — Ansible deploy (dias 6–8) ✅ COMPLETO

Objetivo: Ansible a fazer deploy automático em cada servidor após cada push. **Sem docker-compose no servidor** — Ansible usa `community.docker.docker_container` directamente.

**Ansible — estrutura**
- [x] `ansible/inventory.ini` com `localhost ansible_connection=local` para os 3 grupos (sem SSH)
- [x] `ansible/group_vars/all.yml` com `host.docker.internal` como `db_host` e `backend_host`
- [x] `ansible/playbook.yml` com 3 plays completos:
  - pip SDK instalado com `--break-system-packages`
  - `recreate: true` e `force_source: yes`
  - `ignore_errors: yes` no task de serviço Docker (sem systemd no Jenkins container)
  - Espera de BD pronta + schema garantido via `docker exec`
  - Frontend sem volume mount — usa env vars `BACKEND_HOST`/`BACKEND_PORT`
- [x] Deploy real confirmado a funcionar end-to-end

**Jenkins — stage Deploy adicionado**
- [x] Stage `Deploy via Ansible` adicionado com `sh '''...'''` (aspas simples — secrets não interpolados pelo Groovy)
- [x] Bloco `post` com emails `try/catch` para não falhar se SMTP não estiver configurado

**Estado da pipeline no fim desta fase:**
```
Checkout ✓ → Build images ✓ → Push to Docker Hub ✓ → Deploy via Ansible ✓
                                                              + email notifications ✓
```

---

### Fase 6 — Validação final e polish (dias 8–9)

Objetivo: garantir que tudo funciona de ponta a ponta sem intervenção manual.

- [ ] Fazer um push "limpo" e observar a pipeline completa do início ao fim
- [ ] Verificar app acessível no servidor após deploy
- [ ] Testar cenário de upgrade: alterar algo no código → push → nova imagem → novo deploy automático
- [ ] Confirmar email de sucesso recebido
- [ ] Confirmar imagens no Docker Hub com BUILD_NUMBER correto
- [ ] Testar `restart: unless-stopped`: parar manualmente um container e confirmar que relança

---

### Fase 7 — Relatório e apresentação (dias 9–12)

- [ ] Relatório: arquitectura, fluxos de negócio, Docker Hub, GitHub, Ansible, Jenkins
- [ ] PPT com foco na demo ao vivo da pipeline e da app funcionante
- [ ] Preparar Q&A: saber explicar cada componente e cada decisão tomada
- [ ] Ensaiar demo: push de código → pipeline a correr ao vivo → resultado no servidor

---

## 13. Cuidados e pontos críticos

### Comunicação FE → BE em Docker

O React corre no **browser**, fora da Docker network. O browser não consegue resolver `http://backend:3000`. A solução é o nginx fazer proxy reverso — o FE chama `/api/expenses`, o nginx reescreve para `http://backend:3000/expenses`. Sem este passo, a app não funciona em produção.

### Ordem de arranque dos containers

O backend tenta ligar à BD imediatamente ao arrancar. Se a BD não estiver pronta, o processo falha. Usar `healthcheck` no serviço `db` e `depends_on: { db: { condition: service_healthy } }` no backend resolve este problema.

### Persistência da base de dados

Sem um volume nomeado (`postgres_data`), todos os dados perdem-se ao fazer `docker-compose down`. Garantir que o volume está sempre definido no `docker-compose.yml`.

### `init.sql` e idempotência do schema

O PostgreSQL só executa os ficheiros em `/docker-entrypoint-initdb.d/` na **primeira inicialização** (quando o volume está vazio). Para garantir que o schema existe em volumes pré-existentes (criados por builds anteriores), o playbook Ansible corre sempre `docker exec billing-db psql ... -f init.sql` após a BD estar pronta. Como o `init.sql` usa `IF NOT EXISTS` em todas as instruções, é seguro correr múltiplas vezes sem erros nem duplicação de dados.

### Segurança da API

Cada endpoint de expenses deve verificar que `expense.user_id === req.user.id`. Um utilizador autenticado não deve poder ver nem editar despesas de outro utilizador. Esta validação faz-se na query SQL: `WHERE id = $1 AND user_id = $2`.

### Secrets no Jenkins

O bloco `withCredentials` mascara os valores nos logs (`****`). No entanto, evitar printar variáveis com `echo ${DB_PASS}` — mesmo mascarado, é boa prática não expor.

### Idempotência do Ansible

O playbook deve poder correr múltiplas vezes sem erros. Os módulos `apt`, `file`, `template`, `docker_image`, `docker_container` são todos idempotentes por natureza. Evitar usar o módulo `shell` ou `command` com operações não-idempotentes.

### Tagging de imagens Docker

Sempre usar `BUILD_NUMBER` como tag para rastreabilidade. A tag `latest` é cómoda mas não permite saber qual versão está deployada. Em caso de rollback, pode-se fazer deploy de uma `BUILD_NUMBER` anterior.

---

## 14. Checklist de entrega

### Repositório GitHub
- [ ] Código do frontend presente e funcional
- [ ] Código do backend presente e funcional
- [ ] Jenkinsfile em `jenkins/Jenkinsfile`
- [ ] Ficheiros `.env.example` para FE e BE
- [ ] `README.md` com instruções de arranque local

### Docker Hub
- [ ] Repositório `billing-frontend` com imagens
- [ ] Repositório `billing-backend` com imagens
- [ ] Tags com BUILD_NUMBER visíveis

### Jenkins
- [ ] Pipeline completa com todos os stages funcionais
- [ ] Notificações de email configuradas (sucesso e falha)
- [ ] Credenciais configuradas no Credentials Store

### Ansible
- [ ] Playbook funcional que faz install e upgrade
- [ ] Template docker-compose.yml.j2 com variáveis corretas
- [ ] Deploy verificado no servidor alvo

### Aplicação
- [ ] Login e registo a funcionar
- [ ] CRUD de expenses completo (GET, POST, PATCH, DELETE)
- [ ] Filtros por status e período
- [ ] Mudança de estado pending ↔ paid
- [ ] App acessível via browser após deploy

### Apresentação
- [ ] PPT preparado (foco na pipeline + demo)
- [ ] App a funcionar ao vivo no dia da apresentação
- [ ] Demonstração do Jenkins (trigger e run da pipeline)
- [ ] Docker Hub com imagens visíveis
- [ ] Ansible deploy demonstrável

---

*Documento preparado para uso interno da equipa de desenvolvimento.*  
*Deve ser tratado como fonte de verdade para decisões de arquitectura e implementação.*
