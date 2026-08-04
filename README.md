# JobTrack

一个适合部署到 GitHub Pages 的本地优先求职申请管理系统。

## 功能

- 职位申请新增、编辑、删除
- 状态快速切换
- 进行中 / 已终止 / 全部记录
- 面试日程与月历
- 状态、渠道、转化率与趋势统计
- IndexedDB 本地数据库
- JSON 导入与导出
- 离线缓存与 PWA 基础支持
- Claude 风格主题设计

## 本地运行

为了保证 Service Worker 和 IndexedDB 表现一致，推荐通过本地服务器打开：

```bash
python3 -m http.server 8000
```

然后访问：

```text
http://localhost:8000
```

直接双击 `index.html` 也可以使用主要功能，但离线缓存不会启用。

## GitHub Pages 部署

1. 新建 GitHub 仓库。
2. 上传本项目内全部文件。
3. 打开仓库 `Settings`。
4. 点击 `Pages`。
5. 在 `Build and deployment` 中选择 `Deploy from a branch`。
6. 选择 `main` 分支与 `/root` 目录。
7. 保存后等待 GitHub Pages 生成网站地址。

## 数据存储说明

所有职位、面试和偏好数据都保存在访问者当前浏览器的 IndexedDB 中：

- 不会自动上传到 GitHub
- 不会自动同步到其他设备
- 清除浏览器网站数据后会丢失
- 建议定期在“系统设置”中导出 JSON 备份

未来如果需要多设备同步，可以接入 Supabase、Firebase 或自建 API。
