"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobTask = void 0;
const typeorm_1 = require("typeorm");
const job_entity_1 = require("./job.entity");
let JobTask = class JobTask {
    id;
    jobId;
    job;
    status;
    payload;
    attempts;
    errorMessage;
    createdAt;
    updatedAt;
};
exports.JobTask = JobTask;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], JobTask.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'job_id' }),
    __metadata("design:type", String)
], JobTask.prototype, "jobId", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => job_entity_1.Job, (job) => job.tasks, { onDelete: 'CASCADE' }),
    (0, typeorm_1.JoinColumn)({ name: 'job_id' }),
    __metadata("design:type", job_entity_1.Job)
], JobTask.prototype, "job", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'enum',
        enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
        default: 'PENDING',
    }),
    __metadata("design:type", String)
], JobTask.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'jsonb', nullable: true }),
    __metadata("design:type", Object)
], JobTask.prototype, "payload", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 0 }),
    __metadata("design:type", Number)
], JobTask.prototype, "attempts", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", String)
], JobTask.prototype, "errorMessage", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ type: 'timestamp' }),
    __metadata("design:type", Date)
], JobTask.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)({ type: 'timestamp' }),
    __metadata("design:type", Date)
], JobTask.prototype, "updatedAt", void 0);
exports.JobTask = JobTask = __decorate([
    (0, typeorm_1.Entity)('job_tasks')
], JobTask);
//# sourceMappingURL=job-task.entity.js.map