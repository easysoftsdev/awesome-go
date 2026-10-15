## 🛠️ Step 1: Install Prerequisites

Install the Wails CLI and NSIS (required for Windows installers).

```bash
# Install Wails v3 CLI
go install github.com/wailsapp/wails/v3/cmd/wails3@latest

# Install NSIS (for Windows installer creation)
# On Ubuntu:
sudo apt install nsis

# On Windows:
winget install NSIS.NSIS
```

> Cross-compilation: To build a .deb package from Windows or an .exe from Linux, Wails uses Docker. Run wails3 task setup:docker once to download the necessary image (about 800 MB).


## 📂 Step 2: Create the Project

Open your terminal and create a new Wails project with the React + TypeScript template.

```bash
wails3 init -n pos-installer -t react
cd pos-installer
```

> Note: Since v3.0.0-alpha2.105, TypeScript is the default for the react template. The JavaScript variant is react-js.


Your project structure will include these key files:

- build/ – Build configuration and icons
- frontend/ – Your HTML/CSS/JS UI code
- main.go – Application entry point
- greetservice.go – Example Go service (you will replace this)


## 🧠 Step 3: Write the Go Backend


Replace the entire contents of `main.go` with the following code. This backend handles saving the wizard data and checking if the app is already configured.


```go
package main

import (
	"embed"
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

// Config holds all the settings collected from the Setup Wizard
type Config struct {
	WarehouseName string `json:"warehouse_name"`
	WarehouseLoc  string `json:"warehouse_location"`
	CounterName   string `json:"counter_name"`
	ServerURL     string `json:"server_url"`
	ServerToken   string `json:"server_token"`
	DBHost        string `json:"db_host"`
	DBName        string `json:"db_name"`
	DBUser        string `json:"db_user"`
	DBPass        string `json:"db_pass"`
	IsConfigured  bool   `json:"is_configured"`
}

// SetupService is the Go backend service exposed to the frontend
type SetupService struct{}

// IsConfigured checks if the app has already been set up by looking for a config file
func (s *SetupService) IsConfigured() bool {
	configPath, err := os.UserConfigDir()
	if err != nil {
		return false
	}
	configFile := filepath.Join(configPath, "pos-installer", "config.json")
	_, err = os.Stat(configFile)
	return err == nil
}

// SaveConfig saves the wizard data to a local JSON file and returns a status string
func (s *SetupService) SaveConfig(config Config) string {
	configPath, err := os.UserConfigDir()
	if err != nil {
		return "Error getting config dir: " + err.Error()
	}

	dir := filepath.Join(configPath, "pos-installer")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "Error creating config directory: " + err.Error()
	}

	config.IsConfigured = true

	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return "Error encoding config: " + err.Error()
	}

	configFile := filepath.Join(dir, "config.json")
	if err := os.WriteFile(configFile, data, 0644); err != nil {
		return "Error writing config file: " + err.Error()
	}

	return "Success"
}

// GetConfig reads the saved config from disk
func (s *SetupService) GetConfig() (Config, error) {
	var config Config

	configPath, err := os.UserConfigDir()
	if err != nil {
		return config, err
	}

	configFile := filepath.Join(configPath, "pos-installer", "config.json")
	data, err := os.ReadFile(configFile)
	if err != nil {
		return config, err
	}

	err = json.Unmarshal(data, &config)
	return config, err
}

// ResetConfig deletes the saved config so the wizard runs again
func (s *SetupService) ResetConfig() string {
	configPath, err := os.UserConfigDir()
	if err != nil {
		return "Error getting config dir: " + err.Error()
	}
	configFile := filepath.Join(configPath, "pos-installer", "config.json")
	if err := os.Remove(configFile); err != nil {
		return "Error removing config: " + err.Error()
	}
	return "Success"
}

func main() {
	app := application.New(application.Options{
		Name:        "POS Installer",
		Description: "Offline POS Setup Wizard",
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Services: []application.Service{
			application.NewService(&SetupService{}),
		},
	})

	// Create the main window
	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:   "main",
		Title:  "POS Installer",
		Width:  1024,
		Height: 700,
	})

	// Start the application
	if err := app.Run(); err != nil {
		panic(err)
	}
}
```


## 📌 Key points about this backend


|Section	|Purpose|
|-----------+-------|
//go:embed all:frontend/dist	Embeds the built frontend into the binary. The all: prefix includes files starting with underscores.
var assets embed.FS	Holds the embedded filesystem.
Config struct	Data model shared with the frontend.
IsConfigured()	Returns true if config.json exists.
SaveConfig(config)	Writes the wizard data to config.json.
GetConfig()	Reads the saved config from config.json.
ResetConfig()	Deletes config.json so the wizard runs again.
main()	Sets up the app with embedded assets and starts it.


> Important: The Assets field in application.Options tells Wails to serve the embedded frontend. Without it, you will see a "Missing index.html" error.



## 🎨 Step 4: Build the Wizard UI


**4a. Create the Wizard Component**

Create a new file: `frontend/src/Wizard.tsx`

```tsx
import { useState } from "react";
import { SaveConfig } from "../bindings/pos-installer/setupservice";
import type { Config } from "../bindings/pos-installer/models";

interface WizardProps {
  onComplete: () => void;
}

export default function Wizard({ onComplete }: WizardProps) {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState<Config>({
    warehouse_name: "",
    warehouse_location: "",
    counter_name: "",
    server_url: "",
    server_token: "",
    db_host: "",
    db_name: "",
    db_user: "",
    db_pass: "",
    is_configured: false,
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const nextStep = () => setStep((s) => Math.min(s + 1, 6));
  const prevStep = () => setStep((s) => Math.max(s - 1, 1));

  const handleInstall = async () => {
    const result = await SaveConfig(formData);
    if (result === "Success") {
      alert("Installation complete! Launching POS...");
      onComplete();
    } else {
      alert("Error: " + result);
    }
  };

  return (
    <div className="wizard-container">
      <div className="wizard-header">
        <h1>Offline POS</h1>
        <p>Setup Wizard</p>
      </div>

      <div className="steps-indicator">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className={`step-circle ${i === step ? "active" : i < step ? "done" : ""}`}>
            {i}
          </div>
        ))}
      </div>

      <div className="wizard-content">
        {step === 1 && (
          <div>
            <h2>1. Welcome</h2>
            <p>This wizard will help you install and configure Offline POS.</p>
          </div>
        )}
        {step === 2 && (
          <div>
            <h2>2. Warehouse Setup</h2>
            <div className="form-group">
              <label>Warehouse Name</label>
              <input name="warehouse_name" value={formData.warehouse_name} onChange={handleChange} placeholder="Main Warehouse" />
            </div>
            <div className="form-group">
              <label>Location</label>
              <input name="warehouse_location" value={formData.warehouse_location} onChange={handleChange} placeholder="Dhaka, Bangladesh" />
            </div>
          </div>
        )}
        {step === 3 && (
          <div>
            <h2>3. Counter Setup</h2>
            <div className="form-group">
              <label>Counter Name</label>
              <input name="counter_name" value={formData.counter_name} onChange={handleChange} placeholder="Counter 1" />
            </div>
          </div>
        )}
        {step === 4 && (
          <div>
            <h2>4. Server Configuration</h2>
            <div className="form-group">
              <label>Server URL</label>
              <input name="server_url" value={formData.server_url} onChange={handleChange} placeholder="https://api.yourdomain.com" />
            </div>
            <div className="form-group">
              <label>Server Token</label>
              <input name="server_token" value={formData.server_token} onChange={handleChange} placeholder="sk_live_..." />
            </div>
          </div>
        )}
        {step === 5 && (
          <div>
            <h2>5. Database Configuration</h2>
            <div className="form-group">
              <label>Database Host</label>
              <input name="db_host" value={formData.db_host} onChange={handleChange} placeholder="localhost" />
            </div>
            <div className="form-group">
              <label>Database Name</label>
              <input name="db_name" value={formData.db_name} onChange={handleChange} placeholder="pos_db" />
            </div>
            <div className="form-group">
              <label>Username</label>
              <input name="db_user" value={formData.db_user} onChange={handleChange} placeholder="pos_user" />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input type="password" name="db_pass" value={formData.db_pass} onChange={handleChange} placeholder="********" />
            </div>
          </div>
        )}
        {step === 6 && (
          <div>
            <h2 style={{ textAlign: "center" }}>6. Review & Install</h2>
            <div className="review-box">
              <div><span>Warehouse:</span> {formData.warehouse_name || "N/A"}</div>
              <div><span>Counter:</span> {formData.counter_name || "N/A"}</div>
              <div><span>Server URL:</span> {formData.server_url || "N/A"}</div>
              <div><span>Database Host:</span> {formData.db_host || "N/A"}</div>
            </div>
          </div>
        )}
      </div>

      <div className="wizard-footer">
        <button className="btn-prev" onClick={prevStep} style={{ visibility: step === 1 ? "hidden" : "visible" }}>
          Back
        </button>
        <button className="btn-next" onClick={step === 6 ? handleInstall : nextStep}>
          {step === 6 ? "Install" : "Next"}
        </button>
      </div>
    </div>
  );
}
```
## 4b. Create the POS Screen Component


Create `frontend/src/PosScreen.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { Config } from "../bindings/pos-installer/models";

interface PosScreenProps {
  config: Config | null;
  onReset: () => void;
}

export default function PosScreen({ config, onReset }: PosScreenProps) {
  const [products] = useState([
    { id: 1, name: "Rice", price: 2.0, emoji: "🍚" },
    { id: 2, name: "Sugar", price: 1.5, emoji: "🥣" },
    { id: 3, name: "Cooking Oil", price: 3.2, emoji: "🛢️" },
    { id: 4, name: "Tea", price: 2.5, emoji: "🍵" },
    { id: 5, name: "Biscuits", price: 1.0, emoji: "🍪" },
    { id: 6, name: "Milk", price: 1.2, emoji: "🥛" },
    { id: 7, name: "Bread", price: 1.0, emoji: "🍞" },
    { id: 8, name: "Eggs", price: 2.0, emoji: "🥚" },
  ]);

  const [cart, setCart] = useState<{ id: number; name: string; price: number; qty: number }[]>([]);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const addToCart = (p: { id: number; name: string; price: number }) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.id === p.id);
      if (existing) {
        return prev.map((i) => (i.id === p.id ? { ...i, qty: i.qty + 1 } : i));
      }
      return [...prev, { ...p, qty: 1 }];
    });
  };

  const removeItem = (id: number) => {
    setCart((prev) => prev.filter((i) => i.id !== id));
  };

  const subtotal = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
  const total = subtotal;

  return (
    <div className="pos-app">
      <aside className="pos-sidebar">
        <div className="pos-logo">🖥️ Offline POS</div>
        <nav>
          <div className="nav-item active">🛒 POS</div>
          <div className="nav-item">📦 Products</div>
          <div className="nav-item">🧾 Sales</div>
          <div className="nav-item">📊 Inventory</div>
          <div className="nav-item">👥 Customers</div>
          <div className="nav-item">📈 Reports</div>
          <div className="nav-item">⚙️ Settings</div>
        </nav>
        <div className="pos-user">
          <div>👤 {config?.db_user || "Admin"}</div>
          <small>{config?.server_url || "offline"}</small>
        </div>
      </aside>

      <main className="pos-main">
        <header className="pos-topbar">
          <span className="mode-badge">● Offline Mode</span>
          <div className="topbar-right">
            <button className="btn-clear" onClick={onReset}>Reset Wizard</button>
          </div>
        </header>

        <div className="pos-body">
          <div className="pos-products">
            <input className="search" placeholder="Search product by name, barcode..." />
            <div className="product-grid">
              {products.map((p) => (
                <div key={p.id} className="product-card" onClick={() => addToCart(p)}>
                  <div className="product-emoji">{p.emoji}</div>
                  <div className="product-name">{p.name}</div>
                  <div className="product-price">${p.price.toFixed(2)}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="pos-cart">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Price</th>
                  <th>Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {cart.map((i) => (
                  <tr key={i.id}>
                    <td>{i.name}</td>
                    <td>{i.qty}</td>
                    <td>${i.price.toFixed(2)}</td>
                    <td>${(i.price * i.qty).toFixed(2)}</td>
                    <td>
                      <button className="btn-remove" onClick={() => removeItem(i.id)}>🗑️</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="cart-totals">
              <div className="row"><span>Subtotal</span><span>${subtotal.toFixed(2)}</span></div>
              <div className="row"><span>Discount</span><span>0%</span></div>
              <div className="row total"><span>Total</span><span>${total.toFixed(2)}</span></div>
            </div>

            <button className="btn-pay">💵 Pay (F10)</button>
          </div>
        </div>

        <footer className="pos-footer">
          <span>Warehouse: {config?.warehouse_name || "N/A"}</span>
          <span>Counter: {config?.counter_name || "N/A"}</span>
          <span style={{ marginLeft: "auto" }}>🕐 {now.toLocaleString()}</span>
        </footer>
      </main>
    </div>
  );
}
```


## 4c. Update `App.tsx` to Switch Between Wizard and POS

Replace `frontend/src/App.tsx` entirely:


```tsx
import { useEffect, useState } from "react";
import { IsConfigured, ResetConfig, GetConfig } from "../bindings/pos-installer/setupservice";
import type { Config } from "../bindings/pos-installer/models";
import PosScreen from "./PosScreen";
import Wizard from "./Wizard";

function App() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [savedConfig, setSavedConfig] = useState<Config | null>(null);

  const refresh = async () => {
    const ok = await IsConfigured();
    setConfigured(ok);
    if (ok) {
      try {
        const cfg = await GetConfig();
        setSavedConfig(cfg);
      } catch {
        setSavedConfig(null);
      }
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleReset = async () => {
    await ResetConfig();
    setSavedConfig(null);
    setConfigured(false);
  };

  if (configured === null) return <div className="loading">Loading…</div>;

  if (!configured) {
    return <Wizard onComplete={refresh} />;
  }

  return <PosScreen config={savedConfig} onReset={handleReset} />;
}

export default App;
```


## 4d. Add CSS

Append the following CSS to `frontend/src/App.css`:


```css
/* Wizard Layout */
.wizard-container {
  width: 100%;
  max-width: 520px;
  margin: 0 auto;
  background: white;
  border-radius: 12px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
  overflow: hidden;
  font-family: sans-serif;
}
.wizard-header {
  background: #2563eb;
  color: white;
  padding: 20px;
  text-align: center;
}
.wizard-header h1 {
  margin: 0;
  font-size: 24px;
}
.wizard-header p {
  margin: 5px 0 0;
  font-size: 14px;
  opacity: 0.8;
}
.steps-indicator {
  display: flex;
  justify-content: center;
  padding: 20px;
  border-bottom: 1px solid #e5e7eb;
}
.step-circle {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: #e5e7eb;
  color: #6b7280;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 5px;
  font-weight: bold;
  font-size: 14px;
}
.step-circle.active {
  background: #2563eb;
  color: white;
}
.step-circle.done {
  background: #10b981;
  color: white;
}
.wizard-content {
  padding: 30px;
  min-height: 250px;
}
.wizard-content h2 {
  margin: 0 0 10px;
  color: #1f2937;
}
.form-group {
  margin-bottom: 15px;
}
.form-group label {
  display: block;
  margin-bottom: 5px;
  font-size: 14px;
  color: #374151;
  font-weight: 500;
}
.form-group input {
  width: 100%;
  padding: 10px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  box-sizing: border-box;
}
.wizard-footer {
  padding: 20px 30px;
  background: #f9fafb;
  border-top: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
}
.btn-prev, .btn-next {
  padding: 10px 20px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border: none;
}
.btn-prev {
  background: white;
  border: 1px solid #d1d5db;
  color: #374151;
}
.btn-next {
  background: #2563eb;
  color: white;
}
.review-box {
  background: #f9fafb;
  padding: 15px;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.6;
}
.review-box span {
  font-weight: 600;
  color: #1f2937;
}
.loading {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  font-size: 18px;
}

/* POS Layout */
.pos-app {
  display: flex;
  height: 100vh;
  font-family: sans-serif;
  background: #f3f4f6;
}
.pos-sidebar {
  width: 220px;
  background: #1f2937;
  color: #e5e7eb;
  display: flex;
  flex-direction: column;
  padding: 16px 0;
}
.pos-logo { padding: 12px 20px; font-weight: 700; font-size: 16px; color: #fff; }
.nav-item { padding: 12px 20px; cursor: pointer; font-size: 14px; }
.nav-item:hover { background: #374151; }
.nav-item.active { background: #2563eb; color: #fff; font-weight: 600; }
.pos-user { margin-top: auto; padding: 16px 20px; border-top: 1px solid #374151; font-size: 13px; }
.pos-user small { opacity: 0.6; }
.pos-main { flex: 1; display: flex; flex-direction: column; }
.pos-topbar {
  display: flex; align-items: center; justify-content: space-between;
  background: #fff; padding: 12px 20px; border-bottom: 1px solid #e5e7eb;
}
.mode-badge { color: #10b981; font-weight: 600; font-size: 13px; }
.btn-clear { background: #ef4444; color: #fff; border: none; padding: 8px 14px; border-radius: 6px; cursor: pointer; font-size: 13px; }
.pos-body { flex: 1; display: flex; overflow: hidden; }
.pos-products { flex: 2; padding: 20px; overflow-y: auto; }
.search { width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; margin-bottom: 16px; box-sizing: border-box; }
.product-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.product-card {
  background: #fff; padding: 16px; border-radius: 8px; text-align: center;
  cursor: pointer; border: 1px solid #e5e7eb; transition: all 0.15s;
}
.product-card:hover { border-color: #2563eb; transform: translateY(-2px); }
.product-emoji { font-size: 32px; }
.product-name { font-weight: 600; margin-top: 8px; font-size: 14px; }
.product-price { color: #6b7280; font-size: 13px; }
.pos-cart { flex: 1; background: #fff; border-left: 1px solid #e5e7eb; padding: 20px; display: flex; flex-direction: column; min-width: 320px; }
.pos-cart table { width: 100%; border-collapse: collapse; font-size: 13px; }
.pos-cart th, .pos-cart td { padding: 8px; text-align: left; border-bottom: 1px solid #f3f4f6; }
.btn-remove { background: transparent; border: none; cursor: pointer; }
.cart-totals { margin-top: auto; padding-top: 16px; border-top: 1px solid #e5e7eb; }
.cart-totals .row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; }
.cart-totals .total { font-weight: 700; font-size: 18px; border-top: 1px solid #e5e7eb; padding-top: 12px; margin-top: 6px; }
.btn-pay { margin-top: 16px; background: #2563eb; color: #fff; border: none; padding: 14px; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; }
.btn-pay:hover { background: #1d4ed8; }
.pos-footer {
  display: flex; gap: 20px; padding: 10px 20px; background: #f9fafb;
  border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280;
}
```


## 🔄 Step 5: Generate Bindings
Wails needs to generate the JavaScript/TypeScript bindings so the frontend can communicate with your Go backend.

```bash
wails3 generate bindings
```

This creates the type-safe bindings in `frontend/bindings/pos-installer/`.

Verify the four exports exist:

```bash
grep "export" frontend/bindings/pos-installer/setupservice.js
```

You should see: `IsConfigured`, `SaveConfig`, `GetConfig`, `ResetConfig`.


## 🖼️ Step 6: Set the Application Icon
Create or download a 1024x1024 PNG image for your app. Save it as `build/appicon.png`.

Then, run the icon generation command. Wails will automatically create the required .ico and .icns files for Windows and macOS.

```bash
wails3 generate icons -input build/appicon.png
```


## 🚀 Step 7: Run in Development Mode

```bash
# Clear Snap-related env vars (fixes WebKit crashes on Ubuntu)
unset GTK_PATH
unset GIO_MODULE_DIR
unset LD_LIBRARY_PATH

# Run the app
wails3 dev -port 3000
```
You should see the Setup Wizard from your screenshot. Click through the steps and hit "Install" to test it.


## 📦 Step 8: Build for Ubuntu

```bash
wails3 build
```
This creates a native Linux binary at `bin/pos-installer`. Test it:

Create the Ubuntu `.deb` installer


```bash
wails3 package GOOS=linux
```

This produces multiple formats in the bin/ directory:

- pos-installer.deb — standard Debian/Ubuntu installer
- pos-installer.AppImage — portable, no-install version
- pos-installer.rpm — for Fedora/RHEL
- Send the .deb file to your Ubuntu users. They can install it with:


```bash
sudo dpkg -i pos-installer.deb
```
Or just double-click it in Files → opens Software Center → Install.


## 🪟 Step 9: Build for Windows

To cross-compile for Windows from Ubuntu, you need to have Docker installed and running.


### 9a. Install Docker (if not already)

```bash
sudo apt update
sudo apt install docker.io
sudo usermod -aG docker $USER
# Log out and back in for the group change to take effect
```
Verify:

```bash
docker ps
```

### 9b. Set up the Wails Docker build environment (once)

```bash
wails3 task setup:docker
```

This downloads the Wails Linux→Windows cross-compile image (about 800 MB)


### 9c. Build the Windows installer

```bash
wails3 package GOOS=windows
```


This produces:

- bin/pos-installer.exe — the raw executable
- bin/pos-installer-amd64-installer.exe — the NSIS installer


The `pos-installer-amd64-installer.exe` is the file you send to Windows users. When they double-click it, it:


- Installs the app to C:\Program Files\POS Installer\
- Adds a Start Menu shortcut
- Optionally adds a desktop shortcut
- Registers an uninstaller in Add/Remove Programs


## 📋 Step 10: Summary of Final Outputs

After running all commands, your `bin/` folder will contain:


|File	|Platform	|Purpose|
|-------+-----------+-------|
pos-installer	Ubuntu	Raw binary (for testing)
pos-installer.deb	Ubuntu	Installer for Ubuntu users
pos-installer.AppImage	Linux	Portable, no-install version
pos-installer-amd64-installer.exe	Windows	Installer for Windows users


## 🚀 Step 11: Distribute


- Windows users → send pos-installer-amd64-installer.exe

    - They double-click → installer installs the app → Start Menu entry appears → click it → app opens with the setup wizard.

- Ubuntu users → send pos-installer.deb

    - They double-click → Software Center opens → click Install → app appears in the app grid → click it → setup wizard opens.


After the user completes the setup wizard once, the config is saved to:

- Windows: %APPDATA%\pos-installer\config.json
- Ubuntu: ~/.config/pos-installer/config.json

On all subsequent launches, the app skips the wizard and goes straight to the POS screen.


## ⚠️ Common Build Errors and Their Fixes


| Error	| Fix |
--------+-----
Cannot find module '../bindings/pos-installer/setupservice'	Run wails3 generate bindings
Missing index.html	Ensure //go:embed all:frontend/dist is in main.go and frontend/dist/index.html exists
failed to build frontend	cd frontend && npm install first
NSIS not found	sudo apt install nsis
Docker permission denied	Add your user to the docker group and re-login
TypeScript errors	Fix them in frontend/src/*.tsx — the build will not proceed until TS is clean


## 🎯 Final Commands to Run Right Now
Copy-paste this whole block:


```bash
# 1. Clean env
unset GTK_PATH GIO_MODULE_DIR LD_LIBRARY_PATH

# 2. Regenerate bindings
wails3 generate bindings

# 3. Build native Linux binary
wails3 build

# 4. Test it
./bin/pos-installer &

# 5. Create the Ubuntu installer
wails3 package GOOS=linux

# 6. Create the Windows installer (requires Docker)
wails3 package GOOS=windows

# 7. List all outputs
ls -lh bin/
```
This complete guide should give you a solid foundation for building and distributing your Wails v3 applications. Let me know if you run into any issues along the way.