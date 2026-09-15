# 🚀 গোলাং (Go) - সম্পূর্ণ শেখার রোডম্যাপ (বাংলা)

## 📚 ধাপ ০: গোলাং পরিচিতি ও ইনস্টলেশন

গোলাং কেন শিখবেন?
গুগল তৈরি করেছে (Rob Pike, Ken Thompson)

- সিম্পল, ফাস্ট, কনকারেন্ট
- গুগল, ড্রপবক্স, উবার, টুইটার, কুবারনেটিস, ডকার সব গো-তে লেখা
- গোরুটিন (হালকা থ্রেড) - হাজার হাজার প্যারালাল কাজ একসাথে
### ইনস্টলেশন (Windows/Mac/Linux)

```bash
# Windows: golang.org থেকে .msi ডাউনলোড
# Mac: brew install go
# Linux: sudo apt install golang-go (Ubuntu)

# কাজ চেক করুন
go version
```

### GOPATH vs Go Modules (আধুনিক পদ্ধতি)

```bash
# নতুন প্রজেক্ট তৈরি
mkdir myproject
cd myproject
go mod init myproject  # go.mod ফাইল তৈরি হবে
```

## 📘 ধাপ ১: গোলাং বেসিক (পর্ব ১ - সিনট্যাক্স ও ফান্ডামেন্টাল)