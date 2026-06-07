# AWS EC2 Deployment README

本文档说明如何将舒尔特训练 RESTful API 部署到 AWS EC2。当前服务为 Node.js 原生 HTTP API，默认使用本地 JSON 文件持久化数据。

## 1. 前置条件

- 一台 EC2 实例，建议 Ubuntu 22.04 LTS。
- 已配置 SSH Key。
- 安全组开放：
  - `22/tcp`: SSH，仅允许你的 IP。
  - `80/tcp`: HTTP，对外访问。
  - `443/tcp`: HTTPS，如配置证书。
- 本地已准备好项目代码。

当前服务默认监听 `127.0.0.1:8080`，建议通过 Nginx 对外转发，不直接暴露 8080 端口。

## 2. 本地打包

在本地仓库根目录先运行测试：

```bash
npm test
```

构建单文件服务：

```bash
npm run build
node --check dist/server.js
```

创建发布包：

```bash
npm run package:release
```

发布包路径：

```text
dist/schulte-api-release.tar.gz
```

发布包只包含：

- `package.json`
- `.env.example`
- `dist/server.js`

发布包不包含 `src/`、`test/`、`docs/`、`data/`、`node_modules/` 和 Git 元数据。

当前项目没有第三方运行时依赖，服务只使用 Node.js 内置模块，因此 release 包不需要 `node_modules/`。如果后续在 `package.json` 中新增 `dependencies`，需要改为在服务器执行 `npm ci --omit=dev`，或在构建阶段把依赖一起打进单文件。

## 3. 上传到 EC2

假设：

- SSH Key: `~/.ssh/schulte-api.pem`
- EC2 用户: `ubuntu`
- EC2 地址: `ec2-xx-xx-xx-xx.compute.amazonaws.com`

上传发布包：

```bash
scp -i ~/.ssh/schulte-api.pem \
  dist/schulte-api-release.tar.gz \
  ubuntu@ec2-xx-xx-xx-xx.compute.amazonaws.com:/tmp/schulte-api-release.tar.gz
```

登录服务器：

```bash
ssh -i ~/.ssh/schulte-api.pem ubuntu@ec2-xx-xx-xx-xx.compute.amazonaws.com
```

后续命令均在 EC2 上执行。

## 4. 安装 Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version
npm --version
```

项目要求 Node.js 20 或更高版本。

## 5. 解压并发布项目

```bash
sudo mkdir -p /opt/schulte-api
sudo chown -R ubuntu:ubuntu /opt/schulte-api
mkdir -p /tmp/schulte-api-release
tar -xzf /tmp/schulte-api-release.tar.gz -C /tmp/schulte-api-release
rsync -a --delete /tmp/schulte-api-release/ /opt/schulte-api/
cd /opt/schulte-api
```

验证发布包：

```bash
node --check dist/server.js
```

当前项目无第三方依赖，不需要 `npm install`。

如果后续引入依赖，应在该目录执行：

```bash
npm ci --omit=dev
```

## 6. 配置环境变量

创建环境文件：

```bash
sudo mkdir -p /etc/schulte-api
sudo nano /etc/schulte-api/schulte-api.env
```

内容示例：

```text
PORT=8080
DATA_FILE=/var/lib/schulte-api/store.json
```

准备数据目录：

```bash
sudo mkdir -p /var/lib/schulte-api
sudo chown -R ubuntu:ubuntu /var/lib/schulte-api
sudo chmod 700 /var/lib/schulte-api
```

`DATA_FILE` 会保存用户、会话、Token 映射和训练记录。请定期备份该文件。

## 7. 配置 systemd 服务

创建服务文件：

```bash
sudo nano /etc/systemd/system/schulte-api.service
```

写入：

```ini
[Unit]
Description=Schulte API Service
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/schulte-api
EnvironmentFile=/etc/schulte-api/schulte-api.env
ExecStart=/usr/bin/node /opt/schulte-api/dist/server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable schulte-api
sudo systemctl start schulte-api
sudo systemctl status schulte-api
```

查看日志：

```bash
journalctl -u schulte-api -f
```

如果 `systemctl start` 报错 `Service has no ExecStart=...`，通常是 service 文件内容没有正确写入、`[Service]` 段名拼错、复制了 Markdown 标记，或保存到了错误路径。用下面命令检查实际被 systemd 读取的内容：

```bash
sudo systemctl cat schulte-api
sudo systemd-analyze verify /etc/systemd/system/schulte-api.service
```

确认输出中存在：

```ini
[Service]
ExecStart=/usr/bin/node /opt/schulte-api/dist/server.js
```

如果 Node.js 不在 `/usr/bin/node`，先执行：

```bash
which node
```

然后把 `ExecStart` 中的路径替换为实际路径，再执行：

```bash
sudo systemctl daemon-reload
sudo systemctl restart schulte-api
```

## 8. 配置 Nginx 反向代理

安装 Nginx：

```bash
sudo apt-get update
sudo apt-get install -y nginx
```

创建站点配置：

```bash
sudo nano /etc/nginx/sites-available/schulte-api
```

写入：

```nginx
server {
    listen 80;
    server_name your-domain.example.com;

    location /api/v1/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/schulte-api /etc/nginx/sites-enabled/schulte-api
sudo nginx -t
sudo systemctl reload nginx
```

## 9. 配置 HTTPS

如果已有域名指向 EC2，可使用 Certbot：

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.example.com
```

证书续期通常由 Certbot 自动配置。可检查：

```bash
systemctl list-timers | grep certbot
```

## 10. 验证部署

本机验证服务：

```bash
curl -s http://127.0.0.1:8080/api/v1/guest/training-summary?guestId=test
```

通过 Nginx 验证：

```bash
curl -s http://your-domain.example.com/api/v1/guest/training-summary?guestId=test
```

注册测试：

```bash
curl -s -X POST http://your-domain.example.com/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{
    "nickname": "小明",
    "password": "StrongPassword123",
    "gender": "UNDISCLOSED",
    "acceptedTerms": true,
    "device": {
      "deviceName": "iPhone",
      "platform": "IOS"
    }
  }'
```

响应中应包含 `registrationId`、`accessToken` 和 `refreshToken`。

## 11. 发布更新

### 方式 A：上传发布包

本地重新打包：

```bash
npm test
npm run package:release
```

上传：

```bash
scp -i ~/.ssh/schulte-api.pem \
  dist/schulte-api-release.tar.gz \
  ubuntu@ec2-xx-xx-xx-xx.compute.amazonaws.com:/tmp/schulte-api-release.tar.gz
```

在 EC2 上发布：

```bash
sudo systemctl stop schulte-api
rm -rf /tmp/schulte-api-release
mkdir -p /tmp/schulte-api-release
tar -xzf /tmp/schulte-api-release.tar.gz -C /tmp/schulte-api-release
cp -a /opt/schulte-api /opt/schulte-api.previous.$(date +%Y%m%d%H%M%S)
rsync -a --delete /tmp/schulte-api-release/ /opt/schulte-api/
cd /opt/schulte-api
node --check dist/server.js
sudo systemctl start schulte-api
sudo systemctl status schulte-api
```

### 方式 B：从 Git 拉取

如果服务器能访问代码仓库，也可以直接拉取：

```bash
cd /opt/schulte-api
git pull
npm test
npm run build
sudo systemctl restart schulte-api
sudo systemctl status schulte-api
```

## 12. 回滚版本

如果新版本启动失败，可回滚到上一次备份目录：

```bash
sudo systemctl stop schulte-api
rm -rf /opt/schulte-api
cp -a /opt/schulte-api.previous.YYYYMMDDHHMMSS /opt/schulte-api
cd /opt/schulte-api
node --check dist/server.js
sudo systemctl start schulte-api
sudo systemctl status schulte-api
```

注意替换 `YYYYMMDDHHMMSS` 为真实备份目录后缀。数据文件位于 `/var/lib/schulte-api/store.json`，不在代码目录内，回滚代码不会覆盖数据。

## 13. 数据备份

当前使用本地 JSON 文件，建议至少每天备份：

```bash
sudo cp /var/lib/schulte-api/store.json /var/lib/schulte-api/store.json.$(date +%Y%m%d%H%M%S).bak
```

也可以用 `cron` 定期备份到 S3。数据量超过 10,000 条训练记录、用户超过 100，或需要多实例部署时，应迁移到 SQLite、PostgreSQL 或托管数据库。

## 14. 安全注意事项

- 不要开放 EC2 的 `8080/tcp` 到公网。
- SSH 安全组只允许可信 IP。
- `/var/lib/schulte-api` 权限建议为 `700`。
- 不要提交或公开 `store.json`。
- 生产环境建议配置 HTTPS。
- 当前服务尚未实现限流和集中日志，公网部署时建议在 Nginx 或 API 网关层补充。
