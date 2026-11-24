param([string]$ReadyPath,[string]$WindowTitle)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public class ForgeNativeFixture : Form {
  public string DelayMarker;
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr CreateWindowEx(uint ex, string cls, string text, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool SetWindowText(IntPtr h, string text);
  IntPtr label;
  protected override void OnShown(EventArgs e) {
    base.OnShown(e);
    CreateWindowEx(0,"Edit","",0x50810080,20,20,420,28,Handle,new IntPtr(101),IntPtr.Zero,IntPtr.Zero);
    CreateWindowEx(0,"Button","Apply fixture",0x50010000,20,70,160,32,Handle,new IntPtr(102),IntPtr.Zero,IntPtr.Zero);
    label=CreateWindowEx(0,"Static","Disposable native engineering fixture",0x50000000,20,120,440,28,Handle,new IntPtr(103),IntPtr.Zero,IntPtr.Zero);
    CreateWindowEx(0,"Button","Delayed fixture",0x50010000,220,70,160,32,Handle,new IntPtr(104),IntPtr.Zero,IntPtr.Zero);
  }
  protected override void WndProc(ref Message m) {
    if(m.Msg==0x111 && (m.WParam.ToInt64() & 0xffff)==102) SetWindowText(label,"Fixture clicked");
    if(m.Msg==0x111 && (m.WParam.ToInt64() & 0xffff)==104) {System.IO.File.WriteAllText(DelayMarker,"dispatched");System.Threading.Thread.Sleep(10000);SetWindowText(label,"Delayed fixture completed");}
    base.WndProc(ref m);
  }
}
'@
$form=New-Object ForgeNativeFixture
$form.DelayMarker=$ReadyPath+'.dispatch'
$form.Text=$WindowTitle
$form.Size=New-Object System.Drawing.Size(500,220)
$form.StartPosition='CenterScreen'
$form.Add_Shown({[IO.File]::WriteAllText($ReadyPath,$form.Handle.ToInt64().ToString())})
[System.Windows.Forms.Application]::Run($form)
