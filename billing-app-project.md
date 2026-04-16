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
                         ▼ SSH
                  ┌─────────────┐
                  │ Target Host │
                  │             │
                  │ docker-compose pull
                  │ docker-compose up -d
                  └─────────────┘
```

---

## 3. Modelo de dados

### Tabela `users`

```sql
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);
```

### Tabela `expenses`

```sql
CREATE TABLE expenses (
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

CREATE INDEX idx_expenses_user_id ON expenses(user_id);
CREATE INDEX idx_expenses_status  ON expenses(user_id, status);
```

> **Nota:** O ficheiro `backend/src/db/init.sql` contém este schema completo e é montado automaticamente no container PostgreSQL em `/docker-entrypoint-initdb.d/init.sql` — executa apenas na primeira inicialização (quando o volume está vazio).

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
│   ├── inventory.ini                 ← [billing_servers] com IP do host
│   ├── playbook.yml                  ← tasks de install + upgrade
│   ├── templates/
│   │   └── docker-compose.yml.j2    ← template Jinja2 com {{ vars }}
│   └── group_vars/
│       ├── all.yml                   ← COMMITAR: vars não-sensíveis
│       └── vault.yml                 ← NÃO COMMITAR em plain text; encriptar com ansible-vault
│
├── jenkins/
│   └── Jenkinsfile                   ← pipeline declarativo completo
│
├── docker-compose.yml                ← para desenvolvimento local
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
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

### `frontend/nginx.conf`

```nginx
server {
    listen 80;

    # serve os ficheiros estáticos do React
    location / {
        root   /usr/share/nginx/html;
        index  index.html;
        try_files $uri $uri/ /index.html;   # necessário para React Router
    }

    # proxy reverso: /api/* → backend container
    location /api/ {
        proxy_pass         http://backend:3000/;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
    }
}
```

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
    depends_on: [backend]
    networks: [billing_net]

volumes:
  postgres_data:

networks:
  billing_net:
```

> **Ponto crítico:** em desenvolvimento local, cria um ficheiro `.env` na raiz com as vars `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `JWT_SECRET`. Este ficheiro está no `.gitignore` e nunca é commitado.

### `ansible/templates/docker-compose.yml.j2` (produção)

Igual ao `docker-compose.yml` local, mas com variáveis Jinja2 em vez de `${...}`:

```yaml
# Substituições Jinja2 feitas pelo Ansible em runtime:
# ${DB_NAME}      → {{ db_name }}
# ${DB_PASSWORD}  → {{ db_password }}
# ${JWT_SECRET}   → {{ jwt_secret }}
# build: ./...    → image: {{ dockerhub_user }}/billing-backend:{{ image_tag }}
```

---

## 7. Pipeline Jenkins

### `jenkins/Jenkinsfile`

```groovy
pipeline {
    agent any

    environment {
        // Estas variáveis usam as credenciais configuradas no Jenkins
        // DOCKERHUB_USER e DOCKERHUB_PASS vêm do bloco withCredentials abaixo
        IMAGE_BACKEND  = "billing-backend"
        IMAGE_FRONTEND = "billing-frontend"
    }

    stages {

        stage('Checkout') {
            steps {
                // Jenkins faz checkout automático do repo configurado no job
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
                    credentialsId: 'dockerhub-creds',     // ← criada no Jenkins
                    usernameVariable: 'DOCKERHUB_USER',
                    passwordVariable: 'DOCKERHUB_PASS'
                )]) {
                    sh "docker login -u ${DOCKERHUB_USER} -p ${DOCKERHUB_PASS}"

                    // tag BUILD_NUMBER para rastreabilidade
                    sh "docker tag ${IMAGE_BACKEND}:${BUILD_NUMBER} ${DOCKERHUB_USER}/${IMAGE_BACKEND}:${BUILD_NUMBER}"
                    sh "docker push ${DOCKERHUB_USER}/${IMAGE_BACKEND}:${BUILD_NUMBER}"

                    // tag latest para que Ansible puxe sempre a versão mais recente
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
                    sh """
                        ansible-playbook -i ansible/inventory.ini ansible/playbook.yml \
                            --extra-vars "image_tag=${BUILD_NUMBER} \
                                          dockerhub_user=${DOCKERHUB_USER} \
                                          db_password=${DB_PASS} \
                                          jwt_secret=${JWT_SEC}"
                    """
                }
            }
        }
    }

    post {
        success {
            mail(
                to: 'equipa@email.com',
                subject: "[billing-app] Build #${BUILD_NUMBER} — SUCESSO",
                body: "Pipeline concluída com sucesso.\nDeploy efectuado para o servidor.\nBuild: ${BUILD_URL}"
            )
        }
        failure {
            mail(
                to: 'equipa@email.com',
                subject: "[billing-app] Build #${BUILD_NUMBER} — FALHOU",
                body: "A pipeline falhou. Verifica os logs em:\n${BUILD_URL}console"
            )
        }
        always {
            // limpa imagens locais para não acumular espaço no agente Jenkins
            sh "docker rmi ${IMAGE_BACKEND}:${BUILD_NUMBER} || true"
            sh "docker rmi ${IMAGE_FRONTEND}:${BUILD_NUMBER} || true"
        }
    }
}
```

### Instalação do Jenkins (via Docker)

O Jenkins corre como um container Docker **separado da aplicação** — não faz parte do `docker-compose.yml` da app. É infraestrutura de CI/CD que vive na máquina do developer ou num servidor dedicado.

> **Importante:** o Docker socket tem de ser montado para que o Jenkins consiga correr `docker build` e `docker push` dentro da pipeline.

```bash
docker run -d -p 8080:8080 -p 50000:50000 \
  -v jenkins_home:/var/jenkins_home \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --name jenkins \
  jenkins/jenkins:lts
```

- O volume `jenkins_home` é um **named volume** — persiste mesmo que o container seja removido
- Para parar: `docker stop jenkins`
- Para voltar a correr: `docker start jenkins` (dados intactos)
- Para destruir o volume (apaga tudo): `docker volume rm jenkins_home` — **não correr sem intenção**

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

### `ansible/inventory.ini`

```ini
[billing_servers]
production ansible_host=<IP_DO_SERVIDOR> ansible_user=ubuntu ansible_ssh_private_key_file=~/.ssh/id_rsa
```

### `ansible/group_vars/all.yml` (commitado no repo)

```yaml
# Variáveis não-sensíveis — podem estar no repositório
db_name:        billing_db
db_user:        billing_user
db_port:        5432
app_port:       80
backend_port:   3000
app_dir:        /opt/billing
```

### `ansible/group_vars/vault.yml` (encriptado com ansible-vault)

```yaml
# Para criar: ansible-vault create ansible/group_vars/vault.yml
# Para editar: ansible-vault edit ansible/group_vars/vault.yml
# Para ver:    ansible-vault view ansible/group_vars/vault.yml
vault_db_password: "password_producao_segura"
vault_jwt_secret:  "string_muito_longa_e_aleatoria_para_jwt_producao"
```

> Quando se usa vault, as vars `db_password` e `jwt_secret` no playbook ficam como `"{{ vault_db_password }}"`. No Jenkins, em vez de `--extra-vars`, passa-se `--vault-password-file` com o ficheiro de Secret File. Para simplicidade no contexto deste trabalho, é aceitável usar apenas `--extra-vars` sem vault.

### `ansible/playbook.yml`

```yaml
---
- name: Deploy billing-app
  hosts: billing_servers
  become: true

  tasks:
    - name: Instalar dependências do sistema
      apt:
        name:
          - docker.io
          - docker-compose-plugin
          - python3-pip
        state: present
        update_cache: yes

    - name: Adicionar utilizador ao grupo docker
      user:
        name: "{{ ansible_user }}"
        groups: docker
        append: yes

    - name: Criar directório da aplicação
      file:
        path: "{{ app_dir }}"
        state: directory
        owner: "{{ ansible_user }}"
        mode: "0755"

    - name: Copiar docker-compose para o servidor (via template)
      template:
        src: templates/docker-compose.yml.j2
        dest: "{{ app_dir }}/docker-compose.yml"
        owner: "{{ ansible_user }}"
        mode: "0644"

    - name: Pull das imagens mais recentes
      community.docker.docker_compose_v2:
        project_src: "{{ app_dir }}"
        pull: always
      become_user: "{{ ansible_user }}"

    - name: Iniciar / actualizar containers
      community.docker.docker_compose_v2:
        project_src: "{{ app_dir }}"
        state: present
        recreate: always
      become_user: "{{ ansible_user }}"
```

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
- `recreate: always` garante que o container usa a nova imagem mesmo que o nome não mude
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

### Fase 0 — Arranque e infraestrutura base (dia 0)

Objetivo: repositório criado, Jenkins a correr, primeiro trigger a funcionar.

**GitHub**
- [ ] Confirmar data de apresentação (16/abr ou 21/mai) e constituição do grupo
- [ ] Criar repositório GitHub com estrutura de pastas completa (mesmo que vazias)
- [ ] Criar conta Docker Hub e repositórios `billing-frontend` e `billing-backend`
- [ ] Adicionar `.gitignore` desde o início

**Jenkins — instalação**
- [ ] Instalar Jenkins via Docker (mais rápido e sem conflitos com o sistema):
  ```bash
  docker run -d -p 8080:8080 -p 50000:50000 \
    -v jenkins_home:/var/jenkins_home \
    --name jenkins \
    jenkins/jenkins:lts
  ```
- [ ] Aceder a `localhost:8080`, completar setup inicial, instalar plugins sugeridos
- [ ] Instalar plugins adicionais: **Ansible**, **Docker Pipeline**, **GitHub Integration**

**Jenkins — primeiro job**
- [ ] Criar ficheiro `jenkins/Jenkinsfile` no repositório com apenas o stage de Checkout:
  ```groovy
  pipeline {
    agent any
    stages {
      stage('Checkout') {
        steps { checkout scm }
      }
    }
  }
  ```
- [ ] Criar job Jenkins: New Item → Pipeline → Pipeline script from SCM → apontar para o repo
- [ ] Configurar trigger: GitHub hook trigger (ou Poll SCM `H/5 * * * *` se não houver IP público)
- [ ] Fazer push ao repo e confirmar que o Jenkins deteta a mudança e corre o Checkout

**Estado da pipeline no fim desta fase:**
```
Checkout ✓
```

---

### Fase 1 — Backend e base de dados (dias 1–3)

Objetivo: API REST funcional testável com Postman, sem Docker ainda.

**Código**
- [ ] Criar `backend/src/db/init.sql` com schema completo (tabelas `users` e `expenses`)
- [ ] Implementar `backend/src/db/client.js` — pg Pool usando env vars
- [ ] Implementar `backend/src/routes/auth.js` — POST /register e POST /login com bcrypt + JWT
- [ ] Implementar `backend/src/middleware/auth.js` — verificação de token JWT
- [ ] Implementar `backend/src/routes/expenses.js` — CRUD completo com filtros
- [ ] Criar `backend/.env` local (gitignored) e `backend/.env.example` (commitado)
- [ ] Testar todos os endpoints com Postman ou curl

**Jenkins — nenhuma alteração nesta fase**

A pipeline continua com apenas o stage Checkout. O objetivo desta fase é ter código funcional antes de o containerizar.

**Estado da pipeline no fim desta fase:**
```
Checkout ✓
```

---

### Fase 2 — Frontend (dias 2–4)

Objetivo: interface React funcional a comunicar com o backend local.

**Código**
- [ ] Criar projeto React com Vite (`npm create vite@latest frontend -- --template react`)
- [ ] Implementar `src/api/client.js` — axios com header Authorization automático
- [ ] Implementar páginas: Login, Register, Dashboard
- [ ] Implementar componentes: ExpenseList, ExpenseForm, ExpenseFilters
- [ ] Criar `frontend/.env` local e `frontend/.env.example`
- [ ] Testar app no browser com backend a correr localmente (`node src/index.js`)

**Jenkins — nenhuma alteração nesta fase**

**Estado da pipeline no fim desta fase:**
```
Checkout ✓
```

---

### Fase 3 — Containerização (dias 3–5)

Objetivo: `docker-compose up` local funcional com os 3 containers a comunicar.

**Código**
- [ ] Criar `backend/Dockerfile`
- [ ] Criar `frontend/Dockerfile` (multi-stage: node build → nginx serve)
- [ ] Criar `frontend/nginx.conf` com proxy reverso `/api/*` → `backend:3000`
- [ ] Criar `docker-compose.yml` local com healthcheck na BD e `restart: unless-stopped` em todos os serviços
- [ ] Testar `docker-compose up --build` e verificar que a app funciona em `localhost:80`
- [ ] Verificar que `init.sql` corre automaticamente na primeira inicialização
- [ ] Verificar persistência de dados: `docker-compose down` + `docker-compose up` → dados mantidos

**Jenkins — adicionar stage Build**
- [ ] Atualizar `jenkins/Jenkinsfile` com o stage Build:
  ```groovy
  stage('Build images') {
    steps {
      sh "docker build -t billing-backend:${BUILD_NUMBER} ./backend"
      sh "docker build -t billing-frontend:${BUILD_NUMBER} ./frontend"
    }
  }
  ```
- [ ] Fazer push e confirmar que o Jenkins constrói as imagens com sucesso

**Estado da pipeline no fim desta fase:**
```
Checkout ✓ → Build images ✓
```

---

### Fase 4 — Docker Hub (dias 5–6)

Objetivo: imagens publicadas no Docker Hub após cada build Jenkins bem-sucedida.

**Docker Hub**
- [ ] Confirmar que os repositórios `billing-frontend` e `billing-backend` estão criados no Docker Hub

**Jenkins — credenciais e stage Push**
- [ ] Criar credencial no Jenkins: Manage Jenkins → Credentials → Add → Username with password
  - ID: `dockerhub-creds` · Username: utilizador Docker Hub · Password: password Docker Hub
- [ ] Criar credencial `db-password` (Secret text) — password BD para produção
- [ ] Criar credencial `jwt-secret` (Secret text) — JWT secret para produção
- [ ] Atualizar `jenkins/Jenkinsfile` com o stage Push:
  ```groovy
  stage('Push to Docker Hub') {
    steps {
      withCredentials([usernamePassword(
        credentialsId: 'dockerhub-creds',
        usernameVariable: 'DOCKERHUB_USER',
        passwordVariable: 'DOCKERHUB_PASS'
      )]) {
        sh "docker login -u ${DOCKERHUB_USER} -p ${DOCKERHUB_PASS}"
        sh "docker tag billing-backend:${BUILD_NUMBER} ${DOCKERHUB_USER}/billing-backend:${BUILD_NUMBER}"
        sh "docker push ${DOCKERHUB_USER}/billing-backend:${BUILD_NUMBER}"
        sh "docker tag billing-backend:${BUILD_NUMBER} ${DOCKERHUB_USER}/billing-backend:latest"
        sh "docker push ${DOCKERHUB_USER}/billing-backend:latest"
        sh "docker tag billing-frontend:${BUILD_NUMBER} ${DOCKERHUB_USER}/billing-frontend:${BUILD_NUMBER}"
        sh "docker push ${DOCKERHUB_USER}/billing-frontend:${BUILD_NUMBER}"
        sh "docker tag billing-frontend:${BUILD_NUMBER} ${DOCKERHUB_USER}/billing-frontend:latest"
        sh "docker push ${DOCKERHUB_USER}/billing-frontend:latest"
      }
    }
  }
  ```
- [ ] Adicionar bloco `post` com notificações de email (configurar SMTP em Manage Jenkins → Configure System):
  ```groovy
  post {
    success { mail to: 'equipa@email.com', subject: "Build #${BUILD_NUMBER} OK", body: "Deploy concluído." }
    failure { mail to: 'equipa@email.com', subject: "Build #${BUILD_NUMBER} FALHOU", body: "Ver logs: ${BUILD_URL}console" }
    always  { sh "docker rmi billing-backend:${BUILD_NUMBER} billing-frontend:${BUILD_NUMBER} || true" }
  }
  ```
- [ ] Fazer push e confirmar imagens visíveis no Docker Hub com a tag correta

**Estado da pipeline no fim desta fase:**
```
Checkout ✓ → Build images ✓ → Push to Docker Hub ✓
                                        + email notifications ✓
```

---

### Fase 5 — Ansible deploy (dias 6–8)

Objetivo: Ansible a fazer deploy automático no servidor após cada push.

**Ansible — estrutura**
- [ ] Criar `ansible/inventory.ini` com host alvo (pode ser `localhost` para testar primeiro)
- [ ] Criar `ansible/group_vars/all.yml` com variáveis não-sensíveis
- [ ] Criar `ansible/templates/docker-compose.yml.j2` com variáveis Jinja2
- [ ] Criar `ansible/playbook.yml` completo
- [ ] Testar localmente: `ansible-playbook -i ansible/inventory.ini ansible/playbook.yml --check`
- [ ] Testar deploy real: `ansible-playbook -i ansible/inventory.ini ansible/playbook.yml`
- [ ] Verificar que `install` e `upgrade` são ambos idempotentes (correr 2x sem erros)

**Jenkins — adicionar stage Deploy**
- [ ] Atualizar `jenkins/Jenkinsfile` com o stage Deploy após o Push:
  ```groovy
  stage('Deploy via Ansible') {
    steps {
      withCredentials([
        usernamePassword(credentialsId: 'dockerhub-creds', usernameVariable: 'DOCKERHUB_USER', passwordVariable: 'DOCKERHUB_PASS'),
        string(credentialsId: 'db-password', variable: 'DB_PASS'),
        string(credentialsId: 'jwt-secret',  variable: 'JWT_SEC')
      ]) {
        sh """ansible-playbook -i ansible/inventory.ini ansible/playbook.yml \
              --extra-vars "image_tag=${BUILD_NUMBER} dockerhub_user=${DOCKERHUB_USER} \
                            db_password=${DB_PASS} jwt_secret=${JWT_SEC}" """
      }
    }
  }
  ```
- [ ] Fazer push e verificar deploy end-to-end completo: GitHub → Jenkins → Docker Hub → Ansible → servidor

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

### `init.sql` só corre uma vez

O PostgreSQL só executa os ficheiros em `/docker-entrypoint-initdb.d/` na **primeira inicialização** (quando o volume está vazio). Se precisares de alterar o schema, tens de fazer `docker-compose down -v` (apaga o volume) ou criar migrações manuais.

### Segurança da API

Cada endpoint de expenses deve verificar que `expense.user_id === req.user.id`. Um utilizador autenticado não deve poder ver nem editar despesas de outro utilizador. Esta validação faz-se na query SQL: `WHERE id = $1 AND user_id = $2`.

### Secrets no Jenkins

O bloco `withCredentials` mascara os valores nos logs (`****`). No entanto, evitar printar variáveis com `echo ${DB_PASS}` — mesmo mascarado, é boa prática não expor.

### Idempotência do Ansible

O playbook deve poder correr múltiplas vezes sem erros. Os módulos `apt`, `file`, `template`, `docker_compose_v2` são todos idempotentes por natureza. Evitar usar o módulo `shell` ou `command` com operações não-idempotentes.

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
