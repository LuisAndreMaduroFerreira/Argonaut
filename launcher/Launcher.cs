// Argonaut launcher: wakes Docker, starts every service in docker-compose.yml, waits for the
// app to answer, then shows it in a window of its own: a WebView2, the browser engine built
// into Windows. Speech recognition doesn't depend on the browser: the microphone's recording
// goes to whisper in the argonaut-whisper container, so a web view without the Web Speech API
// loses nothing.
//
// Build with launcher\build.ps1 (C# 5 / .NET Framework 4.x, ships with Windows). It fetches the
// WebView2 SDK and puts its three DLLs beside Argonaut.exe.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("Argonaut")]
[assembly: AssemblyProduct("Argonaut")]
[assembly: AssemblyDescription("Starts the Argonaut knowledge vault")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

namespace Argonaut
{
    internal static class Program
    {
        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        [STAThread]
        private static int Main(string[] args)
        {
            SetProcessDPIAware();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            bool stopRequested = args.Length > 0
                && string.Equals(args[0], "--stop", StringComparison.OrdinalIgnoreCase);

            bool firstInstance;
            using (new Mutex(true, @"Local\ArgonautLauncher", out firstInstance))
            {
                // Argonaut is already open, or on its way: bring that window forward instead.
                if (!firstInstance)
                {
                    AppWindow.FocusExisting();
                    return 0;
                }

                // The splash runs the launch, then hands over to the app's window, which keeps
                // this process (and the mutex) alive until it's closed.
                var splash = new SplashForm();
                var context = new ApplicationContext(splash);
                var launcher = new Launcher(splash, stopRequested);
                splash.Shown += delegate { launcher.Start(); };
                splash.AppReady += delegate
                {
                    var window = new AppWindow(Launcher.AppUrl);
                    context.MainForm = window;
                    window.Show();
                    splash.Close();
                };
                Application.Run(context);
                return launcher.ExitCode;
            }
        }
    }

    internal sealed class LaunchException : Exception
    {
        public LaunchException(string message, string details)
            : base(message)
        {
            Details = details;
        }

        public string Details { get; private set; }
    }

    internal sealed class Launcher
    {
        public const string AppUrl = "http://localhost:8787/";
        private const string HealthUrl = "http://localhost:8787/api/health";

        private static readonly Regex AnsiEscape = new Regex(@"\x1B\[[0-9;?]*[A-Za-z]");

        private readonly SplashForm _splash;
        private readonly bool _stopRequested;

        // Why WSL couldn't be updated, for the error shown if Docker then fails to start.
        private string _wslProblem;

        public Launcher(SplashForm splash, bool stopRequested)
        {
            _splash = splash;
            _stopRequested = stopRequested;
        }

        public int ExitCode { get; private set; }

        public void Start()
        {
            Task.Run(new Action(Run));
        }

        private void Run()
        {
            try
            {
                string projectDir = FindProjectDir();
                string docker = FindDocker();

                if (_stopRequested)
                {
                    Stop(docker, projectDir);
                    return;
                }

                EnsureDockerEngine(docker);

                _splash.SetStatus("Starting Argonaut's services…", "docker compose up");
                // --build keeps the running app in step with the source; unchanged layers come from cache.
                RunDocker(docker, projectDir, "compose up -d --build", "Docker couldn't start Argonaut's services.");

                _splash.SetStatus("Waiting for Argonaut to answer…", AppUrl);
                WaitForHealth(docker, projectDir);

                _splash.SetStatus("Opening Argonaut…", "");
                _splash.OpenApp();
            }
            catch (LaunchException error)
            {
                ExitCode = 1;
                _splash.ShowError(error.Message, error.Details);
            }
            catch (Exception error)
            {
                ExitCode = 1;
                _splash.ShowError("Something unexpected went wrong.", error.ToString());
            }
        }

        private void Stop(string docker, string projectDir)
        {
            _splash.SetStatus("Stopping Argonaut's services…", "docker compose stop");
            if (DockerEngineReady(docker))
            {
                RunDocker(docker, projectDir, "compose stop", "Docker couldn't stop Argonaut's services.");
            }
            _splash.SetStatus("Argonaut's services are stopped.", "");
            _splash.CloseSoon();
        }

        private static string FindProjectDir()
        {
            var candidates = new List<string>();

            string fromEnvironment = Environment.GetEnvironmentVariable("ARGONAUT_HOME");
            if (!string.IsNullOrEmpty(fromEnvironment)) candidates.Add(fromEnvironment);

            // Walking up from the exe lets the project folder move without a rebuild.
            var directory = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);
            while (directory != null)
            {
                candidates.Add(directory.FullName);
                directory = directory.Parent;
            }

            // Baked in at build time, so a copy of the exe on the desktop still finds the project.
            candidates.Add(BuildInfo.ProjectDir);

            foreach (string candidate in candidates)
            {
                if (File.Exists(Path.Combine(candidate, "docker-compose.yml"))
                    && File.Exists(Path.Combine(candidate, "server", "Dockerfile")))
                {
                    return candidate;
                }
            }

            throw new LaunchException(
                "Can't find the Argonaut project folder.",
                "Looked for docker-compose.yml in ARGONAUT_HOME, next to Argonaut.exe and its parent folders, and in "
                + BuildInfo.ProjectDir + ".\r\n\r\n"
                + "Set ARGONAUT_HOME to the knowledge-vault folder, or rebuild with launcher\\build.ps1.");
        }

        private static string ProgramFiles64()
        {
            string path = Environment.GetEnvironmentVariable("ProgramW6432");
            return string.IsNullOrEmpty(path)
                ? Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles)
                : path;
        }

        private static string FindDocker()
        {
            string searchPath = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (string entry in searchPath.Split(Path.PathSeparator))
            {
                string trimmed = entry.Trim().Trim('"');
                if (trimmed.Length == 0) continue;
                try
                {
                    string candidate = Path.Combine(trimmed, "docker.exe");
                    if (File.Exists(candidate)) return candidate;
                }
                catch (ArgumentException)
                {
                    // Malformed PATH entry; keep looking.
                }
            }

            string bundled = Path.Combine(ProgramFiles64(), @"Docker\Docker\resources\bin\docker.exe");
            if (File.Exists(bundled)) return bundled;

            throw new LaunchException(
                "Docker isn't installed.",
                "Argonaut runs its database and API in Docker. Install Docker Desktop, then launch Argonaut again.");
        }

        private void EnsureDockerEngine(string docker)
        {
            _splash.SetStatus("Checking Docker…", "");
            if (DockerEngineReady(docker)) return;

            string desktop = FindDockerDesktop(docker);
            if (desktop == null)
            {
                throw new LaunchException("Docker isn't running.", "Start Docker Desktop, then launch Argonaut again.");
            }

            // Docker Desktop runs inside WSL and won't start while WSL is out of date ("WSL needs
            // updating", 2026-09-30), so WSL is brought up to date first, while Docker is down.
            // A running Docker is left alone: installing an update shuts WSL down, Docker with it.
            string wslVersion = UpdateWsl();

            if (wslVersion != null && DockerDesktopOpen())
            {
                // Already open, it keeps the error it raised about the old WSL until it restarts.
                _splash.SetStatus("Restarting Docker Desktop…", "WSL is now " + wslVersion);
                ProcessRunner.Run(docker, "desktop restart", null, ShowProgressLine, TimeSpan.FromMinutes(3));
            }
            else
            {
                _splash.SetStatus("Waking Docker Desktop…", "this can take a minute");
                Process.Start(new ProcessStartInfo(desktop) { UseShellExecute = true });
            }

            DateTime deadline = DateTime.UtcNow.AddMinutes(3);
            while (DateTime.UtcNow < deadline)
            {
                Thread.Sleep(2000);
                if (DockerEngineReady(docker)) return;
            }

            throw new LaunchException(
                "Docker Desktop didn't become ready within 3 minutes.",
                "Open Docker Desktop and check for errors or pending updates, then launch Argonaut again."
                + (_wslProblem == null ? "" : "\r\n\r\n" + _wslProblem));
        }

        // Returns the version WSL was updated to, or null when it was already current or the update
        // couldn't run. A failed update doesn't stop the launch: Docker may start on the WSL it has.
        private string UpdateWsl()
        {
            string wsl = Wsl.Find();
            if (wsl == null) return null;

            _splash.SetStatus("Checking for WSL updates…", "wsl --update");
            string before = Wsl.Version(wsl);
            ProcessResult result = ProcessRunner.Run(wsl, "--update", null, ShowProgressLine, TimeSpan.FromMinutes(20));
            if (result.ExitCode != 0)
            {
                _wslProblem = "WSL couldn't be updated (wsl --update ended with 0x" + result.ExitCode.ToString("X8") + "):\r\n"
                    + result.Output.Trim();
                return null;
            }

            string after = Wsl.Version(wsl);
            return after != null && after != before ? after : null;
        }

        private static bool DockerDesktopOpen()
        {
            Process[] running = Process.GetProcessesByName("Docker Desktop");
            foreach (Process process in running) process.Dispose();
            return running.Length > 0;
        }

        private static bool DockerEngineReady(string docker)
        {
            return ProcessRunner.Run(docker, "version --format {{.Server.Version}}", null, null, TimeSpan.FromSeconds(20)).ExitCode == 0;
        }

        private static string FindDockerDesktop(string docker)
        {
            // docker.exe normally sits in <install>\resources\bin, two levels below Docker Desktop.exe.
            string besideCli = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(docker), @"..\..\Docker Desktop.exe"));
            if (File.Exists(besideCli)) return besideCli;

            string standard = Path.Combine(ProgramFiles64(), @"Docker\Docker\Docker Desktop.exe");
            return File.Exists(standard) ? standard : null;
        }

        private void RunDocker(string docker, string projectDir, string arguments, string failureMessage)
        {
            ProcessResult result = ProcessRunner.Run(docker, arguments, projectDir, ShowProgressLine, TimeSpan.FromMinutes(20));
            if (result.ExitCode != 0)
            {
                throw new LaunchException(failureMessage, "docker " + arguments + "\r\n\r\n" + result.Output);
            }
        }

        private void ShowProgressLine(string line)
        {
            string clean = AnsiEscape.Replace(line, "").Trim();
            if (clean.Length > 0) _splash.SetDetail(clean);
        }

        private void WaitForHealth(string docker, string projectDir)
        {
            // Docker's port proxy accepts connections before the app listens, so poll the
            // health endpoint rather than trusting that the port is open.
            DateTime deadline = DateTime.UtcNow.AddSeconds(90);
            string lastError = "no response";

            while (DateTime.UtcNow < deadline)
            {
                try
                {
                    var request = (HttpWebRequest)WebRequest.Create(HealthUrl);
                    request.Timeout = 3000;
                    request.Proxy = null; // a system proxy must not intercept localhost
                    using (var response = (HttpWebResponse)request.GetResponse())
                    {
                        if (response.StatusCode == HttpStatusCode.OK) return;
                        lastError = "HTTP " + (int)response.StatusCode;
                    }
                }
                catch (WebException error)
                {
                    lastError = error.Message;
                }
                Thread.Sleep(1000);
            }

            ProcessResult logs = ProcessRunner.Run(docker, "compose logs --tail 60 argonaut-api", projectDir, null, TimeSpan.FromSeconds(30));
            throw new LaunchException(
                "Argonaut's services started, but the app never answered.",
                "Last check of " + HealthUrl + ": " + lastError + "\r\n\r\nRecent API logs:\r\n" + logs.Output);
        }
    }

    internal sealed class ProcessResult
    {
        public int ExitCode;
        public string Output;
    }

    internal static class Wsl
    {
        private static readonly Regex VersionNumber = new Regex(@"\d+(\.\d+){1,3}");

        // wsl.exe is a 64-bit program in System32, which a 32-bit process reaches through Sysnative.
        public static string Find()
        {
            string folder = Environment.Is64BitOperatingSystem && !Environment.Is64BitProcess
                ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "Sysnative")
                : Environment.SystemDirectory;
            string path = Path.Combine(folder, "wsl.exe");
            return File.Exists(path) ? path : null;
        }

        // The WSL package's version: the first number "wsl --version" prints, in any display language.
        public static string Version(string wsl)
        {
            ProcessResult result = ProcessRunner.Run(wsl, "--version", null, null, TimeSpan.FromSeconds(30));
            if (result.ExitCode != 0) return null;
            Match match = VersionNumber.Match(result.Output);
            return match.Success ? match.Value : null;
        }
    }

    internal static class ProcessRunner
    {
        public static ProcessResult Run(string file, string arguments, string workingDirectory, Action<string> onLine, TimeSpan timeout)
        {
            var info = new ProcessStartInfo(file, arguments)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            if (workingDirectory != null) info.WorkingDirectory = workingDirectory;
            // wsl.exe writes UTF-16 unless asked for UTF-8; other programs ignore this.
            info.EnvironmentVariables["WSL_UTF8"] = "1";

            var output = new StringBuilder();
            var gate = new object();
            DataReceivedEventHandler collect = delegate(object sender, DataReceivedEventArgs e)
            {
                if (e.Data == null) return;
                lock (gate) output.AppendLine(e.Data);
                if (onLine != null) onLine(e.Data);
            };

            using (var process = new Process { StartInfo = info })
            {
                process.OutputDataReceived += collect;
                process.ErrorDataReceived += collect;
                process.Start();
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();

                if (!process.WaitForExit((int)timeout.TotalMilliseconds))
                {
                    try
                    {
                        process.Kill();
                    }
                    catch (InvalidOperationException)
                    {
                        // Exited between the timeout and the kill.
                    }
                    lock (gate) return new ProcessResult { ExitCode = -1, Output = output + "(timed out)" };
                }

                process.WaitForExit(); // flushes the asynchronous output handlers
                lock (gate) return new ProcessResult { ExitCode = process.ExitCode, Output = output.ToString() };
            }
        }
    }

    // Argonaut's own window: the app in a WebView2, the browser engine built into Windows. It
    // has its own taskbar entry and profile, and nothing of Edge's around it.
    internal sealed class AppWindow : Form
    {
        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr window);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr window, int command);

        [DllImport("user32.dll")]
        private static extern bool IsIconic(IntPtr window);

        private const int SwRestore = 9;

        // The app's dark background, shown until the first page paints.
        private static readonly Color Background = Color.FromArgb(21, 24, 27);

        private static readonly string DataDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Argonaut");

        private readonly string _appUrl;
        private readonly WebView2 _view;

        public AppWindow(string appUrl)
        {
            _appUrl = appUrl;
            Text = "Argonaut";
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            BackColor = Background;
            MinimumSize = new Size(480, 400);
            PlaceWindow();

            _view = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Background };
            Controls.Add(_view);
            Load += delegate { Initialize(); };
            FormClosing += delegate { SaveBounds(); };
        }

        // Brings an Argonaut window that's already open to the front; false if there is none.
        public static bool FocusExisting()
        {
            Process current = Process.GetCurrentProcess();
            foreach (Process other in Process.GetProcessesByName(current.ProcessName))
            {
                if (other.Id == current.Id) continue;
                IntPtr window = other.MainWindowHandle;
                if (window == IntPtr.Zero) continue;
                if (IsIconic(window)) ShowWindow(window, SwRestore);
                SetForegroundWindow(window);
                return true;
            }
            return false;
        }

        private async void Initialize()
        {
            try
            {
                CoreWebView2Environment environment = await CoreWebView2Environment.CreateAsync(
                    null, Path.Combine(DataDir, "WebView2"), null);
                await _view.EnsureCoreWebView2Async(environment);
            }
            catch (WebView2RuntimeNotFoundException)
            {
                MessageBox.Show(
                    "Argonaut needs the Microsoft Edge WebView2 Runtime, which comes with Windows updates. " +
                    "Install it from https://go.microsoft.com/fwlink/p/?LinkId=2124703 and start Argonaut again.",
                    "Argonaut", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
                return;
            }

            CoreWebView2 core = _view.CoreWebView2;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsGeneralAutofillEnabled = false;
            core.Settings.IsPasswordAutosaveEnabled = false;
            // Developer tools only when asked for, with ARGONAUT_DEVTOOLS=1.
            core.Settings.AreDevToolsEnabled = Environment.GetEnvironmentVariable("ARGONAUT_DEVTOOLS") == "1";

            core.DocumentTitleChanged += delegate
            {
                Text = string.IsNullOrEmpty(core.DocumentTitle) ? "Argonaut" : core.DocumentTitle;
            };

            // The microphone and the clipboard, for Argonaut's own pages only. Anything else is
            // left to WebView2, which asks.
            core.PermissionRequested += (sender, e) =>
            {
                if (!IsApp(e.Uri)) return;
                if (e.PermissionKind == CoreWebView2PermissionKind.Microphone
                    || e.PermissionKind == CoreWebView2PermissionKind.ClipboardRead)
                {
                    e.State = CoreWebView2PermissionState.Allow;
                }
            };

            // Links out of the app (a DOI, a link in a note) open in the everyday browser. A page
            // of the app's own, like a paper's PDF, gets a window of its own as before.
            core.NewWindowRequested += (sender, e) =>
            {
                if (IsApp(e.Uri)) return;
                e.Handled = true;
                OpenOutside(e.Uri);
            };
            core.NavigationStarting += (sender, e) =>
            {
                if (IsApp(e.Uri) || e.Uri.StartsWith("about:", StringComparison.OrdinalIgnoreCase)) return;
                e.Cancel = true;
                OpenOutside(e.Uri);
            };

            // The page asks about the desktop icon, which only this side can see and make:
            // "desktop-shortcut:status" or "desktop-shortcut:create", answered with
            // {"type":"desktop-shortcut","exists":…,"error":…}.
            core.WebMessageReceived += (sender, e) =>
            {
                if (!IsApp(e.Source)) return;
                string message;
                try { message = e.TryGetWebMessageAsString(); }
                catch (ArgumentException) { return; }
                string error = null;
                if (message == "desktop-shortcut:create")
                {
                    try { DesktopShortcut.Create(); }
                    catch (Exception failure) { error = failure.Message; }
                }
                else if (message != "desktop-shortcut:status")
                {
                    return;
                }
                core.PostWebMessageAsJson(string.Format(
                    "{{\"type\":\"desktop-shortcut\",\"exists\":{0},\"error\":{1}}}",
                    DesktopShortcut.Exists() ? "true" : "false",
                    error == null ? "null" : JsonString(error)));
            };

            core.Navigate(_appUrl);
        }

        private static string JsonString(string text)
        {
            var json = new StringBuilder("\"");
            foreach (char c in text)
            {
                if (c == '"' || c == '\\') json.Append('\\').Append(c);
                else if (c < ' ') json.AppendFormat("\\u{0:x4}", (int)c);
                else json.Append(c);
            }
            return json.Append('"').ToString();
        }

        private bool IsApp(string uri)
        {
            return uri != null
                && (uri.StartsWith(_appUrl, StringComparison.OrdinalIgnoreCase)
                    || uri.StartsWith("blob:" + _appUrl.TrimEnd('/'), StringComparison.OrdinalIgnoreCase)
                    || uri.StartsWith("data:", StringComparison.OrdinalIgnoreCase));
        }

        private static void OpenOutside(string uri)
        {
            Uri parsed;
            if (!Uri.TryCreate(uri, UriKind.Absolute, out parsed)) return;
            if (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps && parsed.Scheme != Uri.UriSchemeMailto) return;
            try
            {
                Process.Start(new ProcessStartInfo(parsed.AbsoluteUri) { UseShellExecute = true });
            }
            catch (Exception)
            {
                // No browser registered: the link just doesn't open.
            }
        }

        // Where the window was and how big, remembered between runs: "x y width height maximized".
        private static string BoundsFile
        {
            get { return Path.Combine(DataDir, "window.txt"); }
        }

        private void PlaceWindow()
        {
            StartPosition = FormStartPosition.CenterScreen;
            Rectangle work = Screen.PrimaryScreen.WorkingArea;
            Size = new Size(Math.Min(1440, work.Width), Math.Min(900, work.Height));
            try
            {
                if (!File.Exists(BoundsFile)) return;
                string[] parts = File.ReadAllText(BoundsFile).Trim().Split(' ');
                var bounds = new Rectangle(int.Parse(parts[0]), int.Parse(parts[1]), int.Parse(parts[2]), int.Parse(parts[3]));
                // Only where a screen still is, in case a monitor was unplugged.
                bool visible = false;
                foreach (Screen screen in Screen.AllScreens)
                {
                    if (screen.WorkingArea.IntersectsWith(bounds)) visible = true;
                }
                if (!visible || bounds.Width < MinimumSize.Width || bounds.Height < MinimumSize.Height) return;
                StartPosition = FormStartPosition.Manual;
                Bounds = bounds;
                if (parts.Length > 4 && parts[4] == "1") WindowState = FormWindowState.Maximized;
            }
            catch (Exception)
            {
                // A damaged file only costs the remembered place.
            }
        }

        private void SaveBounds()
        {
            try
            {
                Rectangle bounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
                Directory.CreateDirectory(DataDir);
                File.WriteAllText(BoundsFile, string.Format("{0} {1} {2} {3} {4}",
                    bounds.X, bounds.Y, bounds.Width, bounds.Height,
                    WindowState == FormWindowState.Maximized ? 1 : 0));
            }
            catch (Exception)
            {
                // Not remembering the window's place is harmless.
            }
        }
    }

    // A shortcut to this Argonaut.exe on the desktop, made through Windows' own WScript.Shell.
    // Any .lnk on the user's or the shared desktop that points at this exe counts, whatever
    // its name. ARGONAUT_DESKTOP stands in for the desktop folder, for testing.
    internal static class DesktopShortcut
    {
        private static string UserDesktop
        {
            get
            {
                string testing = Environment.GetEnvironmentVariable("ARGONAUT_DESKTOP");
                return string.IsNullOrEmpty(testing)
                    ? Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory)
                    : testing;
            }
        }

        private static IEnumerable<string> Desktops()
        {
            yield return UserDesktop;
            if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("ARGONAUT_DESKTOP")))
            {
                yield return Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory);
            }
        }

        public static bool Exists()
        {
            string exe = Application.ExecutablePath;
            object shell = NewShell();
            try
            {
                foreach (string desktop in Desktops())
                {
                    if (string.IsNullOrEmpty(desktop) || !Directory.Exists(desktop)) continue;
                    foreach (string path in Directory.GetFiles(desktop, "*.lnk"))
                    {
                        try
                        {
                            object link = Call(shell, "CreateShortcut", path);
                            string target = Get(link, "TargetPath") as string;
                            Marshal.ReleaseComObject(link);
                            if (string.Equals(target, exe, StringComparison.OrdinalIgnoreCase)) return true;
                        }
                        catch (Exception)
                        {
                            // A shortcut Windows can't read isn't ours.
                        }
                    }
                }
                return false;
            }
            finally
            {
                Marshal.ReleaseComObject(shell);
            }
        }

        public static void Create()
        {
            if (Exists()) return;
            string exe = Application.ExecutablePath;
            // "Argonaut.lnk", or "Argonaut 2.lnk" if a shortcut to something else has the name.
            string path = Path.Combine(UserDesktop, "Argonaut.lnk");
            for (int number = 2; File.Exists(path); number++)
            {
                path = Path.Combine(UserDesktop, "Argonaut " + number + ".lnk");
            }
            object shell = NewShell();
            try
            {
                object link = Call(shell, "CreateShortcut", path);
                Set(link, "TargetPath", exe);
                Set(link, "WorkingDirectory", Path.GetDirectoryName(exe));
                Set(link, "IconLocation", exe + ",0");
                Set(link, "Description", "Argonaut");
                Call(link, "Save");
                Marshal.ReleaseComObject(link);
            }
            finally
            {
                Marshal.ReleaseComObject(shell);
            }
        }

        private static object NewShell()
        {
            Type type = Type.GetTypeFromProgID("WScript.Shell");
            if (type == null) throw new InvalidOperationException("Windows Script Host isn't available.");
            return Activator.CreateInstance(type);
        }

        private static object Call(object target, string method, params object[] arguments)
        {
            return target.GetType().InvokeMember(method, BindingFlags.InvokeMethod, null, target, arguments);
        }

        private static object Get(object target, string property)
        {
            return target.GetType().InvokeMember(property, BindingFlags.GetProperty, null, target, null);
        }

        private static void Set(object target, string property, object value)
        {
            target.GetType().InvokeMember(property, BindingFlags.SetProperty, null, target, new[] { value });
        }
    }

    internal sealed class SplashForm : Form
    {
        [DllImport("user32.dll")]
        private static extern bool ReleaseCapture();

        [DllImport("user32.dll")]
        private static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);

        private const int WmNcLeftButtonDown = 0xA1;
        private const int HtCaption = 0x2;

        // The app's dark theme palette (src/styles.css).
        private static readonly Color Background = Color.FromArgb(21, 24, 27);
        private static readonly Color Surface = Color.FromArgb(28, 32, 36);
        private static readonly Color Border = Color.FromArgb(44, 50, 56);
        private static readonly Color Heading = Color.FromArgb(244, 248, 251);
        private static readonly Color Body = Color.FromArgb(198, 220, 236);
        private static readonly Color Muted = Color.FromArgb(120, 136, 148);
        private static readonly Color Gold = Color.FromArgb(199, 155, 69);

        private readonly float _scale;
        private readonly Image _mark;
        private readonly Label _status;
        private readonly Label _detail;
        private readonly TextBox _errorDetails;
        private readonly Button _copyButton;
        private readonly Button _closeButton;
        private readonly System.Windows.Forms.Timer _animation;

        // Written by the launcher thread, drained by the animation timer, so noisy build
        // output never floods the UI thread with invokes.
        private volatile string _pendingDetail;
        private float _shuttle;
        private bool _failed;

        public SplashForm()
        {
            using (Graphics graphics = CreateGraphics()) _scale = graphics.DpiX / 96f;

            Text = "Argonaut";
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Background;
            ClientSize = new Size(S(460), S(190));
            DoubleBuffered = true;
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);

            using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("Argonaut.Mark.png"))
            {
                if (stream != null)
                {
                    // GDI+ reads images lazily, so copy before the stream closes.
                    using (Image original = Image.FromStream(stream)) _mark = new Bitmap(original);
                }
            }

            Label title = MakeLabel("Argonaut", new Font("Georgia", 17f), Heading, new Rectangle(S(112), S(34), S(320), S(36)));
            _status = MakeLabel("Preparing…", new Font("Segoe UI", 10f), Body, new Rectangle(S(113), S(74), S(320), S(42)));
            _detail = MakeLabel("", new Font("Consolas", 8.5f), Muted, new Rectangle(S(114), S(118), S(316), S(18)));
            _detail.AutoEllipsis = true;

            _errorDetails = new TextBox
            {
                Multiline = true,
                ReadOnly = true,
                ScrollBars = ScrollBars.Vertical,
                BorderStyle = BorderStyle.None,
                BackColor = Surface,
                ForeColor = Body,
                Font = new Font("Consolas", 8.5f),
                Bounds = new Rectangle(S(33), S(151), S(394), S(174)),
                Visible = false,
            };

            _copyButton = MakeButton("Copy details", new Rectangle(S(226), S(342), S(106), S(30)));
            _closeButton = MakeButton("Close", new Rectangle(S(340), S(342), S(88), S(30)));
            _copyButton.Click += delegate { Clipboard.SetText(_status.Text + "\r\n\r\n" + _errorDetails.Text); };
            _closeButton.Click += delegate { Close(); };
            CancelButton = _closeButton;

            Controls.AddRange(new Control[] { title, _status, _detail, _errorDetails, _copyButton, _closeButton });

            // The window is borderless, so let any non-interactive surface drag it.
            MouseDown += DragWindow;
            title.MouseDown += DragWindow;
            _status.MouseDown += DragWindow;
            _detail.MouseDown += DragWindow;

            _animation = new System.Windows.Forms.Timer { Interval = 16 };
            _animation.Tick += delegate
            {
                string detail = _pendingDetail;
                if (detail != null)
                {
                    _pendingDetail = null;
                    _detail.Text = detail;
                }
                _shuttle = (_shuttle + 0.012f) % 1.4f;
                Invalidate(new Rectangle(0, ClientSize.Height - S(3), ClientSize.Width, S(3)));
            };
            _animation.Start();
        }

        public void SetStatus(string status, string detail)
        {
            _pendingDetail = null;
            Ui(delegate
            {
                _status.Text = status;
                _detail.Text = detail;
            });
        }

        public void SetDetail(string detail)
        {
            _pendingDetail = detail;
        }

        // Raised on the UI thread once the services answer: the app's window takes over.
        public event EventHandler AppReady;

        public void OpenApp()
        {
            Ui(delegate
            {
                if (AppReady != null) AppReady(this, EventArgs.Empty);
            });
        }

        public void CloseSoon()
        {
            Ui(delegate
            {
                var timer = new System.Windows.Forms.Timer { Interval = 700 };
                timer.Tick += delegate
                {
                    timer.Stop();
                    timer.Dispose();
                    Close();
                };
                timer.Start();
            });
        }

        public void ShowError(string message, string details)
        {
            Ui(delegate
            {
                _failed = true;
                _animation.Stop();
                _status.Text = message;
                _status.ForeColor = Gold;
                _detail.Text = "";
                _errorDetails.Text = (details ?? "").Replace("\r\n", "\n").Replace("\n", "\r\n");
                _errorDetails.Visible = true;
                _copyButton.Visible = true;
                _closeButton.Visible = true;
                ClientSize = new Size(ClientSize.Width, S(392));
                CenterToScreen();
                Invalidate();
                Activate();
            });
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            Graphics graphics = e.Graphics;
            graphics.SmoothingMode = SmoothingMode.AntiAlias;
            graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;

            if (_mark != null) graphics.DrawImage(_mark, new Rectangle(S(32), S(38), S(64), S(64)));

            using (var pen = new Pen(Border))
            {
                graphics.DrawRectangle(pen, 0, 0, ClientSize.Width - 1, ClientSize.Height - 1);
                if (_failed)
                {
                    Rectangle box = _errorDetails.Bounds;
                    box.Inflate(S(6), S(6));
                    graphics.DrawRectangle(pen, box);
                }
            }

            if (_failed) return;

            // A soft gold shuttle sliding along the bottom edge while work is in progress.
            float width = ClientSize.Width;
            var shuttle = new RectangleF((_shuttle - 0.4f) * width, ClientSize.Height - S(2), width * 0.4f, S(2));
            RectangleF gradientArea = shuttle;
            gradientArea.Inflate(1, 0); // avoids GDI+ wrapping a hard edge pixel at the far end
            using (var brush = new LinearGradientBrush(gradientArea, Color.Transparent, Color.Transparent, LinearGradientMode.Horizontal))
            {
                brush.InterpolationColors = new ColorBlend
                {
                    Colors = new[] { Color.FromArgb(0, Gold), Gold, Color.FromArgb(0, Gold) },
                    Positions = new[] { 0f, 0.5f, 1f },
                };
                graphics.FillRectangle(brush, shuttle);
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                _animation.Dispose();
                if (_mark != null) _mark.Dispose();
            }
            base.Dispose(disposing);
        }

        private int S(float value)
        {
            return (int)Math.Round(value * _scale);
        }

        private Label MakeLabel(string text, Font font, Color color, Rectangle bounds)
        {
            return new Label
            {
                Text = text,
                Font = font,
                ForeColor = color,
                BackColor = Background,
                Bounds = bounds,
                AutoSize = false,
                UseMnemonic = false,
            };
        }

        private Button MakeButton(string text, Rectangle bounds)
        {
            var button = new Button
            {
                Text = text,
                Bounds = bounds,
                Visible = false,
                FlatStyle = FlatStyle.Flat,
                BackColor = Background,
                ForeColor = Gold,
                Font = new Font("Segoe UI", 9f),
                Cursor = Cursors.Hand,
            };
            button.FlatAppearance.BorderColor = Border;
            button.FlatAppearance.MouseOverBackColor = Surface;
            return button;
        }

        private void DragWindow(object sender, MouseEventArgs e)
        {
            if (e.Button != MouseButtons.Left) return;
            ReleaseCapture();
            SendMessage(Handle, WmNcLeftButtonDown, (IntPtr)HtCaption, IntPtr.Zero);
        }

        private void Ui(MethodInvoker action)
        {
            if (IsDisposed) return;
            try
            {
                if (InvokeRequired) BeginInvoke(action);
                else action();
            }
            catch (InvalidOperationException)
            {
                // The window closed while the launcher was still working.
            }
        }
    }
}
