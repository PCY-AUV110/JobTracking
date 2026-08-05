# 求职管理系统（Job Tracking System）开发报告（Version 0.1 Demo）

**项目名称：** Job Tracking System\
**开发阶段：** MVP（Minimum Viable Product）Demo\
**开发时间：** 2026年8月\
**开发目标：**
为求职者提供一个集中管理求职全过程的平台，帮助用户记录投递情况、跟踪招聘流程、管理面试信息，并逐步发展成为一站式
AI 求职助手。

------------------------------------------------------------------------

# 一、项目背景

目前大部分求职者都会同时申请几十甚至上百个岗位。

由于招聘流程较长，不同公司的流程又各不相同，因此经常会出现：

-   忘记什么时候投递
-   不知道哪家公司回复了
-   面试时间冲突
-   Offer 管理混乱
-   简历版本太多
-   无法统计自己的求职情况

因此，本项目旨在开发一个轻量级 Job Tracking
System，用一个平台管理整个求职生命周期。

------------------------------------------------------------------------

# 二、系统总体架构

``` text
Job Tracking System
├── Dashboard
├── Job Applications
├── Companies
├── Calendar
├── Analytics
├── Documents
└── AI Assistant（规划中）
```

未来数据统一存储在数据库（Supabase/Firebase）中，实现多设备同步。

------------------------------------------------------------------------

# 三、目前已完成的功能（Demo）

## 1. Dashboard（主页）

-   展示 Total Applications、Interview、Offers、Rejections 等统计信息。
-   预留 Recent Applications、Upcoming Interviews 等模块。

## 2. Job Applications（申请管理）

已完成：

-   Job List（岗位列表）
-   Job Detail（岗位详情）
-   Status 管理（Applied、OA、Interview、Final
    Interview、Offer、Rejected）
-   Search（公司、职位搜索）
-   Status Filter（按状态筛选）

## 3. 页面导航

已完成 Dashboard、Jobs、Companies、Analytics 等页面导航。

## 4. Demo 数据

当前采用 Mock Data，无需数据库即可完成演示。

------------------------------------------------------------------------

# 四、正在开发中的功能

## 高优先级

-   接入 Supabase/Firebase 数据库
-   新增岗位（Add New Job）
-   编辑岗位（Edit Job）
-   删除岗位（Delete Job）

## 中期规划

-   Company 页面
-   Calendar
-   Analytics
-   Resume Manager
-   Cover Letter 管理
-   Interview Notes
-   Reminder

## 长期规划

-   Email Integration（Gmail / Outlook）
-   AI Resume Review
-   AI Cover Letter
-   AI Job Match
-   AI Interview Preparation
-   AI Follow-up Email

------------------------------------------------------------------------

# 五、当前开发状态

  模块          状态
  ------------- -------------
  React 前端    ✅ 已完成
  Dashboard     ✅ 已完成
  Job List      ✅ 已完成
  Job Detail    ✅ 已完成
  Search        ✅ 已完成
  Status 管理   ✅ 已完成
  Mock Data     ✅ 已完成
  Database      ⏳ 开发中
  用户登录      ⏳ 未完成
  CRUD          ⏳ 未完成
  Calendar      ⏳ 未完成
  Analytics     ⏳ 页面预留
  Resume 管理   ⏳ 未完成
  AI 功能       📋 已规划

------------------------------------------------------------------------

# 六、Roadmap

## Phase 1

-   数据库接入
-   用户登录
-   完整 CRUD
-   数据持久化

## Phase 2

-   Company 页面
-   Calendar
-   Resume / Cover Letter
-   Interview Notes
-   Analytics Dashboard

## Phase 3

-   AI Resume Review
-   AI Cover Letter
-   AI Interview Coach
-   AI Job Match
-   Email 自动同步

------------------------------------------------------------------------

# 七、项目总结

目前项目已经完成 MVP
Demo，实现了求职岗位管理、状态跟踪、搜索和基础数据展示等核心能力，能够完整演示系统整体流程。当前仍采用本地
Mock Data，数据库、用户登录及数据持久化功能尚未完成。

下一阶段将重点接入
Supabase，实现云端数据存储与用户认证，并逐步扩展公司管理、日历提醒、数据分析以及
AI 求职助手等功能，最终打造覆盖整个求职流程的一站式智能求职管理平台。
