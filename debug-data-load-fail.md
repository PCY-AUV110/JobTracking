# 调试会话: data-load-fail

状态: [OPEN]

## 症状
- 之前的申请记录丢失
- 管理员界面不可见
- 网页显示"数据加载失败"

## 假设列表

### H1: profiles 表 RLS 策略冲突
- **可证伪**: 在浏览器控制台查看 applications/interviews 查询的错误信息
- **观察点**: 检查 RLS 策略是否允许普通用户读取自己的数据

### H2: profiles 表为空导致认证流程中断
- **可证伪**: 查看 onAuthStateChanged 函数的执行日志
- **观察点**: checkAdminAccess() 是否抛出异常导致后续代码未执行

### H3: Service Worker 缓存冲突
- **可证伪**: 检查浏览器 DevTools 中的 SW 版本
- **观察点**: 用户是否在使用旧版本缓存的代码

### H4: 数据库 Schema 迁移不完整
- **可证伪**: 在 SQL Editor 中检查表结构和触发器
- **观察点**: 检查 profiles 表、触发器、RLS 策略是否完整

## 调试步骤
1. 收集浏览器控制台错误
2. 检查数据库查询结果
3. 分析错误堆栈
4. 确定根因并修复

## 进展记录
