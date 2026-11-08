import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { spawn } from 'node:child_process';

const projectId = process.env.GCP_PROJECT_ID;
const secretName = process.env.GCP_SECRET_NAME || 'emissor-nfs-credentials';

if (!projectId) {
  console.error('[ERRO] Variavel de ambiente GCP_PROJECT_ID obrigatoria.');
  process.exit(1);
}

async function carregarCredenciaisGCP() {
  console.log('[VAULT] Conectando ao Google Secret Manager...');

  const options = { projectId };
  if (process.env.GCP_CREDENTIALS_JSON) {
    try {
      options.credentials = JSON.parse(process.env.GCP_CREDENTIALS_JSON);
    } catch (err) {
      console.error('[ERRO] Falha ao interpretar GCP_CREDENTIALS_JSON:', err.message);
      process.exit(1);
    }
  }

  const client = new SecretManagerServiceClient(options);
  const name = `projects/${projectId}/secrets/${secretName}/versions/latest`;

  try {
    const [version] = await client.accessSecretVersion({ name });
    const payload = version.payload?.data?.toString('utf8');

    if (!payload) {
      throw new Error('Payload do segredo retornado vazio.');
    }

    const secrets = JSON.parse(payload);

    if (!secrets.CERT_BASE64 || !secrets.CERT_PASSWORD) {
      throw new Error('O JSON do segredo precisa conter CERT_BASE64 e CERT_PASSWORD.');
    }

    // Injeta em memoria no ambiente do processo sem tocar o disco
    process.env.CERT_BASE64 = secrets.CERT_BASE64;
    process.env.CERT_PASSWORD = secrets.CERT_PASSWORD;

    console.log('[VAULT] Certificado A1 e credenciais carregados com sucesso.');
  } catch (err) {
    console.error('[ERRO] Falha ao obter segredo do GCP:', err.message);
    process.exit(1);
  }
}

async function main() {
  await carregarCredenciaisGCP();

  // Executa o comando padrao do painel repassando o ambiente carregado em memoria
  const child = spawn('node', ['bin/cli.mjs', 'painel'], {
    stdio: 'inherit',
    env: process.env,
  });

  // Repassa os sinais para que o encerramento limpo (SIGTERM/SIGINT) continue funcionando
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  process.on('SIGINT', () => child.kill('SIGINT'));

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    }
    process.exit(code ?? 0);
  });
}

main();