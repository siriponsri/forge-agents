$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase,System.Drawing
  Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
public static class ForgeWindow {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsChild(IntPtr parent, IntPtr child);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint process);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder text, int max);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder text, int max);
  [DllImport("user32.dll", EntryPoint="GetWindowLongW")] public static extern int Style(IntPtr h, int index);
  [DllImport("user32.dll")] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out Rect r);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, EntryPoint="SendMessageTimeoutW")] static extern IntPtr SendTextMessage(IntPtr h, uint msg, IntPtr w, string l, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, EntryPoint="SendMessageTimeoutW")] static extern IntPtr ReadTextMessage(IntPtr h, uint msg, IntPtr w, StringBuilder l, uint flags, uint timeout, out IntPtr result);
  public static string Class(IntPtr h) {var s=new StringBuilder(256);GetClassName(h,s,256);return s.ToString();}
  public static string ReadEdit(IntPtr h) {var s=new StringBuilder(10001);IntPtr r;if(ReadTextMessage(h,13,new IntPtr(10001),s,2,1000,out r)==IntPtr.Zero)throw new Exception("Selected Edit read timed out");return s.ToString();}
  public static void SetEdit(IntPtr h,string text) {IntPtr r;if(SendTextMessage(h,12,IntPtr.Zero,text,2,1000,out r)==IntPtr.Zero || r==IntPtr.Zero)throw new Exception("Selected Edit text input refused or timed out");}
  public static void ClickButton(IntPtr h) {IntPtr r;if(SendMessageTimeout(h,0xF5,IntPtr.Zero,IntPtr.Zero,2,1000,out r)==IntPtr.Zero)throw new Exception("Selected Button click timed out");}
  public struct Rect { public int left,top,right,bottom; }
  public static long[] Windows() { var list=new List<long>(); EnumWindows((h,p)=>{var s=new StringBuilder(1024);GetWindowText(h,s,1024);if(IsWindowVisible(h)&&s.Length>0)list.Add(h.ToInt64());return true;},IntPtr.Zero);return list.ToArray(); }
  public static string Title(IntPtr h) {var s=new StringBuilder(1024);GetWindowText(h,s,1024);return s.ToString();}
  public static string Capture(IntPtr h, out int width, out int height) {
    Rect r;if(!GetWindowRect(h,out r))throw new Exception("Window bounds unavailable");width=r.right-r.left;height=r.bottom-r.top;
    if(width<1||height<1||width>4096||height>4096)throw new Exception("Window screenshot outside bounded dimensions");
    using(var b=new Bitmap(width,height)) {using(var g=Graphics.FromImage(b)){var dc=g.GetHdc();try{if(!PrintWindow(h,dc,2))throw new Exception("Target does not support PrintWindow");}finally{g.ReleaseHdc(dc);}}using(var s=new MemoryStream()){b.Save(s,ImageFormat.Png);return Convert.ToBase64String(s.ToArray());}}
  }
}
'@
  function SessionIdentity {
    $current = [Diagnostics.Process]::GetCurrentProcess()
    $desktop = [ForgeWindow]::OpenInputDesktop(0,$false,0x0100)
    if ($current.SessionId -eq 0 -or $desktop -eq [IntPtr]::Zero) { throw 'No unlocked interactive Windows desktop is available' }
    [void][ForgeWindow]::CloseDesktop($desktop)
    return @{sessionId=$current.SessionId;machine=[Environment]::MachineName;adapter='Microsoft UI Automation + targeted Win32 messages';platform=[Environment]::OSVersion.VersionString}
  }
  function WindowIdentity([IntPtr]$handle) {
    [uint32]$processId = 0
    [void][ForgeWindow]::GetWindowThreadProcessId($handle,[ref]$processId)
    $owner = [Diagnostics.Process]::GetProcessById($processId)
    return @{hwnd=$handle.ToInt64().ToString();processId=[int]$processId;processStart=$owner.StartTime.ToUniversalTime().Ticks.ToString();sessionId=$owner.SessionId}
  }
  $session = SessionIdentity
  if ($request.operation -eq 'health') { $result=$session }
  elseif ($request.operation -eq 'list') {
    $result=@(foreach ($rawHandle in [ForgeWindow]::Windows()) {
      try { $handle=[IntPtr]$rawHandle;$identity=WindowIdentity $handle;if($identity.sessionId -eq $session.sessionId){@{identity=$identity;title=[ForgeWindow]::Title($handle)}} } catch { }
    })
  } else {
    $identity=$request.identity
    $handle=[IntPtr]([long]$identity.hwnd)
    if(-not [ForgeWindow]::IsWindow($handle)){throw 'Selected window no longer exists'}
    $actual=WindowIdentity $handle
    if($actual.processId -ne $identity.processId -or $actual.processStart -ne $identity.processStart -or $actual.sessionId -ne $identity.sessionId -or $actual.sessionId -ne $session.sessionId){throw 'Selected window identity changed'}
    $root=[System.Windows.Automation.AutomationElement]::FromHandle($handle)
    if($request.operation -eq 'validate'){ $result=@{identity=$actual} }
    elseif($request.operation -eq 'focus'){if(-not [ForgeWindow]::SetForegroundWindow($handle)){throw 'Windows refused foreground focus'};$result=@{focused=$true}}
    elseif($request.operation -eq 'screenshot'){
      [int]$width=0;[int]$height=0;$png=[ForgeWindow]::Capture($handle,[ref]$width,[ref]$height);$result=@{png=$png;width=$width;height=$height}
    } else {
      $elements=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
      $bounded=@($root)+@($elements | Select-Object -First 250)
      if($request.operation -eq 'inspect'){
        $result=@{identity=$actual;title=[ForgeWindow]::Title($handle);elements=@(foreach($element in $bounded){try{
          $c=$element.Current;$patterns=@();foreach($p in $element.GetSupportedPatterns()){$patterns+=$p.ProgrammaticName}
          $item=@{elementId=($element.GetRuntimeId() -join '.');name=$c.Name;automationId=$c.AutomationId;controlType=$c.ControlType.ProgrammaticName;enabled=$c.IsEnabled;password=$c.IsPassword;patterns=$patterns}
          $nativeHandle=[IntPtr]$c.NativeWindowHandle
          $nativeClass=[ForgeWindow]::Class($nativeHandle)
          $item.nativeClass=$nativeClass
          $nativePassword=($nativeClass -match '(^Edit$|WindowsForms10\.EDIT)' -and (([ForgeWindow]::Style($nativeHandle,-16) -band 0x20) -ne 0))
          if($nativePassword){$item.password=$true}
          $item.nativeActions=@()
          if([ForgeWindow]::IsChild($handle,$nativeHandle)){
            if($nativeClass -match '(^Edit$|WindowsForms10\.EDIT)' -and -not $item.password){$item.nativeActions=@('type','key');$item.value=[ForgeWindow]::ReadEdit($nativeHandle)}
            if($nativeClass -match '(^Button$|WindowsForms10\.BUTTON)'){$item.nativeActions=@('click')}
          }
          if(-not $item.password){$vp=$null;if($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$vp)){$item.value=$vp.Current.Value.Substring(0,[Math]::Min(10000,$vp.Current.Value.Length))}}
          else {$item.name='[password control]'}
          $item
        }catch{}})}
      } else {
        $element=@($bounded | Where-Object { ($_.GetRuntimeId() -join '.') -eq $request.args.elementId })
        if($element.Count -ne 1){throw 'Element is stale or outside selected window; inspect again'}
        $element=$element[0]
        if($element.Current.IsPassword){throw 'Password controls are excluded'}
        $nativeHandle=[IntPtr]$element.Current.NativeWindowHandle
        $nativeClass=[ForgeWindow]::Class($nativeHandle)
        $nativeChild=[ForgeWindow]::IsChild($handle,$nativeHandle)
        if($nativeClass -match '(^Edit$|WindowsForms10\.EDIT)' -and (([ForgeWindow]::Style($nativeHandle,-16) -band 0x20) -ne 0)){throw 'Password controls are excluded'}
        if(-not $element.Current.IsEnabled){throw 'Selected element is disabled'}
        if($request.operation -eq 'type'){
          $valuePattern=$null
          if($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$valuePattern)){
            if($valuePattern.Current.IsReadOnly){throw 'Element is read only'}
            $valuePattern.SetValue([string]$request.args.text)
            $result=@{typed=$true;mode='UIA ValuePattern replace';verified=($valuePattern.Current.Value -eq $request.args.text)}
          }elseif($nativeChild -and $nativeClass -match '(^Edit$|WindowsForms10\.EDIT)'){
            if(([ForgeWindow]::Style($nativeHandle,-16) -band 0x800) -ne 0){throw 'Selected Edit is read only'}
            [ForgeWindow]::SetEdit($nativeHandle,[string]$request.args.text)
            $result=@{typed=$true;mode='targeted Edit WM_SETTEXT replace';verified=([ForgeWindow]::ReadEdit($nativeHandle) -eq $request.args.text)}
          }else{throw 'Element supports neither ValuePattern nor a native Edit text input'}
        }elseif($request.operation -eq 'click'){
          $invokePattern=$null
          if($element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$invokePattern)){
            $invokePattern.Invoke();$result=@{clicked=$true;mode='UIA InvokePattern'}
          }elseif($nativeChild -and $nativeClass -match '(^Button$|WindowsForms10\.BUTTON)'){
            [ForgeWindow]::ClickButton($nativeHandle);$result=@{clicked=$true;mode='targeted Button BM_CLICK'}
          }else{throw 'Element supports neither InvokePattern nor a native Button click'}
        }elseif($request.operation -eq 'key'){
          $childHandle=[IntPtr]$element.Current.NativeWindowHandle
          $class=New-Object System.Text.StringBuilder 256
          [void][ForgeWindow]::GetClassName($childHandle,$class,256)
          if($childHandle -eq [IntPtr]::Zero -or -not [ForgeWindow]::IsChild($handle,$childHandle) -or $class.ToString() -notmatch '(^Edit$|WindowsForms10\.EDIT)'){throw 'Key input supports selected native Edit controls only'}
          $keyCodes=@{Enter=13;Tab=9;Escape=27;Backspace=8;Delete=46;ArrowLeft=37;ArrowUp=38;ArrowRight=39;ArrowDown=40;Home=36;End=35}
          if(-not $keyCodes.ContainsKey([string]$request.args.key)){throw 'Unsupported key'}
          [IntPtr]$messageResult=[IntPtr]::Zero
          foreach($msg in @(0x100,0x101)){if([ForgeWindow]::SendMessageTimeout($childHandle,$msg,[IntPtr]$keyCodes[[string]$request.args.key],[IntPtr]::Zero,2,1000,[ref]$messageResult) -eq [IntPtr]::Zero){throw 'Selected control key input timed out'}}
          $result=@{key=$request.args.key;mode='targeted Edit window message'}
        }else{throw 'Unsupported bounded native action'}
      }
    }
  }
  @{ok=$true;result=$result}|ConvertTo-Json -Depth 14 -Compress
} catch {
  # Fixed error messages avoid leaking stack traces, paths, environment or text arguments.
  $message=$_.Exception.Message
  if($message.Length -gt 250){$message='Windows UI Automation failed or this operation is unsupported by the selected application'}
  @{ok=$false;code='WINDOWS_ACTION';message=$message}|ConvertTo-Json -Compress
}
