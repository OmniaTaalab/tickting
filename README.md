# NIS CRM - Parent Care CRM 🚀

## نظرة عامة (Overview)
نظام **NIS CRM** هو منصة متكاملة لإدارة علاقات أولياء الأمور (CRM) ونظام دعم فني (Help Desk) مصمم خصيصاً للمؤسسات التعليمية. يهدف النظام إلى تنظيم التواصل بين أولياء الأمور وأقسام المدرسة المختلفة (IT, HR, Finance, etc.) لضمان حل المشكلات بسرعة واحترافية.

## المميزات الرئيسية (Key Features)
- **استقبال التذاكر من قنوات متعددة**: (Email, Phone, Walk-in, Social Media, Web API).
- **التوزيع الذكي (Intelligent Routing)**:
  - **Round-Robin**: توزيع التذاكر تلقائياً على الموظفين المتاحين.
  - **AI Assignment**: استخدام الذكاء الاصطناعي (Genkit) لاقتراح القسم المناسب.
- **إدارة مستوى الخدمة (SLA Management)**: تتبع زمن الاستجابة بناءً على أولوية التذكرة وقناة الاتصال.
- **ساعات العمل الذكية**: نظام يتحكم في الردود الآلية وتعيين المهام بناءً على جدول عمل كل قسم.
- **لوحة تحكم وتحليلات**: رسوم بيانية لحظية لمتابعة أداء الأقسام والموظفين.
- **تتبع ساعات العمل**: تسجيل فترات تواجد الموظفين (Available vs Busy) لحساب الإنتاجية.

## الأدوار والصلاحيات (User Roles)
1. **مدير النظام (Admin)**: سيطرة كاملة، إدارة الموظفين، إعدادات الفروع، والتحليلات الشاملة.
2. **مدير القسم (Manager)**: إدارة موظفي قسمه فقط، متابعة تذاكر القسم، وتحليلات الأداء الخاصة به.
3. **الموظف (Employee)**: التعامل مع التذاكر الموكلة إليه، متابعة مهامه اليومية، وتحديث حالته.

## التقنيات المستخدمة (Tech Stack)
- **Framework**: Next.js 15 (App Router)
- **Database & Auth**: Firebase (Firestore, Authentication)
- **Backend Logic**: Firebase Cloud Functions & Server Actions
- **UI Components**: Shadcn UI & Tailwind CSS
- **AI Engine**: Google Genkit (Gemini 2.5 Flash)
- **Data Export**: XLSX for professional reports

---

## للبدء (Getting Started)
للحصول على تفاصيل تقنية حول كيفية عمل النظام، يرجى مراجعة ملف:
`docs/SYSTEM_GUIDE.md`

© 2024 NIS CRM System
