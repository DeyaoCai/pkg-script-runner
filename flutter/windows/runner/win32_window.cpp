#include "win32_window.h"

#include <dwmapi.h>
#include <flutter_windows.h>
#include <windowsx.h>

#include "color_tokens.h"
#include "resource.h"

namespace {

#ifndef DWMWA_USE_IMMERSIVE_DARK_MODE
#define DWMWA_USE_IMMERSIVE_DARK_MODE 20
#endif

constexpr const wchar_t kWindowClassName[] = L"FLUTTER_RUNNER_WIN32_WINDOW";

constexpr const wchar_t kGetPreferredBrightnessRegKey[] =
    L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize";
constexpr const wchar_t kGetPreferredBrightnessRegValue[] = L"AppsUseLightTheme";

static int g_active_window_count = 0;

using EnableNonClientDpiScaling = BOOL __stdcall(HWND hwnd);

int Scale(int source, double scale_factor) {
  return static_cast<int>(source * scale_factor);
}

void EnableFullDpiSupportIfAvailable(HWND hwnd) {
  HMODULE user32_module = LoadLibraryA("User32.dll");
  if (!user32_module) {
    return;
  }
  auto enable_non_client_dpi_scaling =
      reinterpret_cast<EnableNonClientDpiScaling*>(
          GetProcAddress(user32_module, "EnableNonClientDpiScaling"));
  if (enable_non_client_dpi_scaling != nullptr) {
    enable_non_client_dpi_scaling(hwnd);
  }
  FreeLibrary(user32_module);
}

}  // namespace

class WindowClassRegistrar {
 public:
  ~WindowClassRegistrar() = default;

  static WindowClassRegistrar* GetInstance() {
    if (!instance_) {
      instance_ = new WindowClassRegistrar();
    }
    return instance_;
  }

  const wchar_t* GetWindowClass();

  void UnregisterWindowClass();

 private:
  WindowClassRegistrar() = default;

  static WindowClassRegistrar* instance_;

  bool class_registered_ = false;
};

WindowClassRegistrar* WindowClassRegistrar::instance_ = nullptr;

const wchar_t* WindowClassRegistrar::GetWindowClass() {
  if (!class_registered_) {
    WNDCLASS window_class{};
    window_class.hCursor = LoadCursor(nullptr, IDC_ARROW);
    window_class.lpszClassName = kWindowClassName;
    window_class.style = CS_HREDRAW | CS_VREDRAW;
    window_class.cbClsExtra = 0;
    window_class.cbWndExtra = 0;
    window_class.hInstance = GetModuleHandle(nullptr);
    window_class.hIcon =
        LoadIcon(window_class.hInstance, MAKEINTRESOURCE(IDI_APP_ICON));
    window_class.hbrBackground = 0;
    window_class.lpszMenuName = nullptr;
    window_class.lpfnWndProc = Win32Window::WndProc;
    RegisterClass(&window_class);
    class_registered_ = true;
  }
  return kWindowClassName;
}

void WindowClassRegistrar::UnregisterWindowClass() {
  UnregisterClass(kWindowClassName, nullptr);
  class_registered_ = false;
}

Win32Window::Win32Window() { ++g_active_window_count; }

Win32Window::~Win32Window() {
  --g_active_window_count;
  Destroy();
}

bool Win32Window::Create(const std::wstring& title,
                         const Point& origin,
                         const Size& size) {
  Destroy();

  const wchar_t* window_class =
      WindowClassRegistrar::GetInstance()->GetWindowClass();

  const POINT target_point = {static_cast<LONG>(origin.x),
                              static_cast<LONG>(origin.y)};
  HMONITOR monitor = MonitorFromPoint(target_point, MONITOR_DEFAULTTONEAREST);
  UINT dpi = FlutterDesktopGetDpiForMonitor(monitor);
  double scale_factor = dpi / 96.0;

  HWND window = CreateWindow(
      window_class, title.c_str(), WS_OVERLAPPEDWINDOW,
      Scale(origin.x, scale_factor), Scale(origin.y, scale_factor),
      Scale(size.width, scale_factor), Scale(size.height, scale_factor),
      nullptr, nullptr, GetModuleHandle(nullptr), this);

  if (!window) {
    return false;
  }

  UpdateTheme(window);
  HideTitleBar();
  return OnCreate();
}

bool Win32Window::Show() {
  return ShowWindow(window_handle_, SW_SHOWNORMAL);
}

// static
LRESULT CALLBACK Win32Window::WndProc(HWND const window,
                                      UINT const message,
                                      WPARAM const wparam,
                                      LPARAM const lparam) noexcept {
  if (message == WM_NCCREATE) {
    auto window_struct = reinterpret_cast<CREATESTRUCT*>(lparam);
    SetWindowLongPtr(window, GWLP_USERDATA,
                     reinterpret_cast<LONG_PTR>(window_struct->lpCreateParams));

    auto that = static_cast<Win32Window*>(window_struct->lpCreateParams);
    EnableFullDpiSupportIfAvailable(window);
    that->window_handle_ = window;
  } else if (Win32Window* that = GetThisFromHandle(window)) {
    return that->MessageHandler(window, message, wparam, lparam);
  }

  return DefWindowProc(window, message, wparam, lparam);
}

LRESULT
Win32Window::MessageHandler(HWND hwnd,
                            UINT const message,
                            WPARAM const wparam,
                            LPARAM const lparam) noexcept {
  switch (message) {
    case WM_DESTROY:
      window_handle_ = nullptr;
      Destroy();
      if (quit_on_close_) {
        PostQuitMessage(0);
      }
      return 0;

    case WM_DPICHANGED: {
      auto newRectSize = reinterpret_cast<RECT*>(lparam);
      LONG newWidth = newRectSize->right - newRectSize->left;
      LONG newHeight = newRectSize->bottom - newRectSize->top;

      SetWindowPos(hwnd, nullptr, newRectSize->left, newRectSize->top, newWidth,
                   newHeight, SWP_NOZORDER | SWP_NOACTIVATE);

      return 0;
    }
    case WM_SIZE: {
      RECT rect = GetClientArea();
      if (child_content_ != nullptr) {
        MoveWindow(child_content_, rect.left, rect.top, rect.right - rect.left,
                   rect.bottom - rect.top, TRUE);
      }
      return 0;
    }

    case WM_NCCALCSIZE:
      // Make the whole window client area. Leaving a native caption/NC strip
      // after clearing WS_CAPTION is what paints the white band at the top.
      if (wparam) {
        return 0;
      }
      return 0;

    case WM_NCHITTEST: {
      // With no NC frame, map edges to resize / caption so drag+resize still work.
      LRESULT hit = DefWindowProc(hwnd, message, wparam, lparam);
      if (hit != HTCLIENT) {
        return hit;
      }
      POINT cursor{GET_X_LPARAM(lparam), GET_Y_LPARAM(lparam)};
      RECT window_rect{};
      ::GetWindowRect(hwnd, &window_rect);
      const int border = ::GetSystemMetrics(SM_CXFRAME) +
                         ::GetSystemMetrics(SM_CXPADDEDBORDER);
      const bool left = cursor.x < window_rect.left + border;
      const bool right = cursor.x >= window_rect.right - border;
      const bool top = cursor.y < window_rect.top + border;
      const bool bottom = cursor.y >= window_rect.bottom - border;
      if (top && left) return HTTOPLEFT;
      if (top && right) return HTTOPRIGHT;
      if (bottom && left) return HTBOTTOMLEFT;
      if (bottom && right) return HTBOTTOMRIGHT;
      if (left) return HTLEFT;
      if (right) return HTRIGHT;
      if (top) return HTTOP;
      if (bottom) return HTBOTTOM;
      return HTCLIENT;
    }

    case WM_ACTIVATE:
      if (child_content_ != nullptr) {
        SetFocus(child_content_);
      }
      return 0;

    case WM_ENTERSIZEMOVE:
      // Live blur-behind recomposites every move frame -> lag. Solid fill instead.
      ApplyDragFill(hwnd);
      break;

    case WM_EXITSIZEMOVE:
      ApplyBlurBehind(hwnd);
      break;

    case WM_DWMCOLORIZATIONCOLORCHANGED:
      UpdateTheme(hwnd);
      return 0;
  }

  return DefWindowProc(window_handle_, message, wparam, lparam);
}

void Win32Window::Destroy() {
  OnDestroy();

  if (window_handle_) {
    DestroyWindow(window_handle_);
    window_handle_ = nullptr;
  }
  if (g_active_window_count == 0) {
    WindowClassRegistrar::GetInstance()->UnregisterWindowClass();
  }
}

Win32Window* Win32Window::GetThisFromHandle(HWND const window) noexcept {
  return reinterpret_cast<Win32Window*>(
      GetWindowLongPtr(window, GWLP_USERDATA));
}

void Win32Window::SetChildContent(HWND content) {
  child_content_ = content;
  SetParent(content, window_handle_);
  RECT frame = GetClientArea();

  MoveWindow(content, frame.left, frame.top, frame.right - frame.left,
             frame.bottom - frame.top, true);

  SetFocus(child_content_);
}

RECT Win32Window::GetClientArea() {
  RECT frame;
  GetClientRect(window_handle_, &frame);
  return frame;
}

HWND Win32Window::GetHandle() { return window_handle_; }

void Win32Window::SetQuitOnClose(bool quit_on_close) {
  quit_on_close_ = quit_on_close;
}

bool Win32Window::OnCreate() { return true; }

void Win32Window::OnDestroy() {}

void Win32Window::UpdateTheme(HWND const window) {
  DWORD light_mode;
  DWORD light_mode_size = sizeof(light_mode);
  LSTATUS result = RegGetValue(HKEY_CURRENT_USER, kGetPreferredBrightnessRegKey,
                               kGetPreferredBrightnessRegValue,
                               RRF_RT_REG_DWORD, nullptr, &light_mode,
                               &light_mode_size);

  if (result == ERROR_SUCCESS) {
    BOOL enable_dark_mode = light_mode == 0;
    DwmSetWindowAttribute(window, DWMWA_USE_IMMERSIVE_DARK_MODE,
                          &enable_dark_mode, sizeof(enable_dark_mode));
  }
}

void Win32Window::SetAccentPolicy(HWND const window,
                                  int accent_state,
                                  unsigned int gradient_color) {
  if (!window) {
    return;
  }

  using SetWindowCompositionAttribute = BOOL(WINAPI*)(HWND, void*);
  HMODULE user32 = LoadLibraryA("user32.dll");
  if (!user32) {
    return;
  }
  auto set_composition = reinterpret_cast<SetWindowCompositionAttribute>(
      GetProcAddress(user32, "SetWindowCompositionAttribute"));
  if (set_composition) {
    struct AccentPolicy {
      int accent_state;
      int accent_flags;
      unsigned int gradient_color;
      int animation_id;
    };
    struct CompositionData {
      int attribute;
      void* data;
      unsigned long data_size;
    };
    AccentPolicy policy = {accent_state, 2, gradient_color, 0};
    CompositionData data = {19, &policy, sizeof(policy)};
    set_composition(window, &data);
  }
  FreeLibrary(user32);
}

void Win32Window::ApplyBlurBehind(HWND const window) {
  // ACCENT_ENABLE_BLURBEHIND = 3. See color_tokens.h / ColorTokens.glassTint.
  // Do not call DwmExtendFrameIntoClientArea(-1) here - whites out Flutter + Accent.
  SetAccentPolicy(window, 3, kGlassTintAccent);
}

void Win32Window::ApplyDragFill(HWND const window) {
  // ACCENT_ENABLE_GRADIENT = 1. See ColorTokens.glassDragFill.
  SetAccentPolicy(window, 1, kGlassDragFillAccent);
}

void Win32Window::HideTitleBar() {
  HWND window = window_handle_;
  if (!window) {
    return;
  }

  // Strip caption only. Keep thick-frame resize. Avoid DwmExtendFrame margins={0}
  // (that is what window_manager TitleBarStyle.hidden does and it kills glass).
  LONG_PTR style = ::GetWindowLongPtr(window, GWL_STYLE);
  style &= ~(WS_CAPTION | WS_SYSMENU);
  style |= WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;
  ::SetWindowLongPtr(window, GWL_STYLE, style);
  ::SetWindowPos(window, nullptr, 0, 0, 0, 0,
                 SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER |
                     SWP_NOOWNERZORDER);

  // Stretch Flutter view into the former caption strip.
  RECT rect = GetClientArea();
  if (child_content_ != nullptr) {
    ::MoveWindow(child_content_, rect.left, rect.top, rect.right - rect.left,
                 rect.bottom - rect.top, TRUE);
  }

  ApplyBlurBehind(window);
}

