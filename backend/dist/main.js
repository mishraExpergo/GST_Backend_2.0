"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const os_1 = require("os");
const app_module_1 = require("./app.module");
function getLocalIPs() {
    const nets = (0, os_1.networkInterfaces)();
    const ips = [];
    for (const name of Object.keys(nets)) {
        for (const net of nets[name] ?? []) {
            if (net.family === 'IPv4' && !net.internal) {
                ips.push(net.address);
            }
        }
    }
    return ips;
}
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    const port = Number(process.env.PORT) || 3000;
    const host = process.env.HOST ?? '0.0.0.0';
    await app.listen(port, host);
    const logger = new common_1.Logger('Bootstrap');
    const url = await app.getUrl();
    logger.log('=================================================');
    logger.log(`Server is running`);
    logger.log(`Local:            http://localhost:${port}`);
    for (const ip of getLocalIPs()) {
        logger.log(`On Your Network:  http://${ip}:${port}`);
    }
    logger.log(`Bound to:         ${host}:${port}`);
    logger.log(`Nest URL:         ${url}`);
    logger.log(`Environment:      ${process.env.NODE_ENV ?? 'development'}`);
    logger.log(`PID:              ${process.pid}`);
    logger.log('=================================================');
}
bootstrap();
//# sourceMappingURL=main.js.map