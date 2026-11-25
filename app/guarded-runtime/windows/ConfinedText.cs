// FORGE engineering broker. MIT. Windows local NTFS, existing UTF-8 text only.
// Every component is opened relative to a held directory handle with
// FILE_OPEN_REPARSE_POINT; no path-based reopen occurs after validation.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

class ConfinedText {
  [StructLayout(LayoutKind.Sequential)] struct UNICODE_STRING { public ushort Length, MaximumLength; public IntPtr Buffer; }
  [StructLayout(LayoutKind.Sequential)] struct OBJECT_ATTRIBUTES { public int Length; public IntPtr RootDirectory, ObjectName; public uint Attributes; public IntPtr SecurityDescriptor, SecurityQualityOfService; }
  [StructLayout(LayoutKind.Sequential)] struct IO_STATUS_BLOCK { public IntPtr Status, Information; }
  [StructLayout(LayoutKind.Sequential)] struct INFO { public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write; public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow; }
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFile(string p,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle h,out INFO info);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern uint GetDriveType(string p);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool GetVolumeInformation(string p,StringBuilder volume,uint vsize,out uint serial,out uint max,out uint flags,StringBuilder fs,uint fsize);
  [DllImport("ntdll.dll")] static extern int NtCreateFile(out SafeFileHandle h,uint access,ref OBJECT_ATTRIBUTES oa,out IO_STATUS_BLOCK iosb,IntPtr alloc,uint attrs,uint share,uint disposition,uint options,IntPtr ea,uint ealen);
  static readonly UTF8Encoding Utf8=new UTF8Encoding(false,true);
  static readonly JavaScriptSerializer Json=new JavaScriptSerializer { MaxJsonLength=300000 };
  static readonly List<SafeFileHandle> Parents=new List<SafeFileHandle>();
  static FileStream File;
  static string Ticket;
  static int Maximum;
  static string Hash(byte[] b) { using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(b)).Replace("-","").ToLowerInvariant(); }
  static INFO Info(SafeFileHandle h,bool dir) { INFO i;if(!GetFileInformationByHandle(h,out i))throw new Exception("HANDLE_INFO");if((i.Attributes&0x400)!=0||(((i.Attributes&0x10)!=0)!=dir)||(!dir&&i.Links!=1))throw new Exception("UNSAFE_FILE");return i; }
  static SafeFileHandle Relative(SafeFileHandle parent,string part,bool dir,bool write) {
    if(part.Length==0||part=="."||part==".."||part.IndexOfAny(new char[]{'\\','/',':','\0'})>=0||part.EndsWith(".")||part.EndsWith(" "))throw new Exception("PATH_DENIED");
    var text=Marshal.StringToHGlobalUni(part);var us=new UNICODE_STRING {Length=(ushort)(part.Length*2),MaximumLength=(ushort)(part.Length*2),Buffer=text};var usp=Marshal.AllocHGlobal(Marshal.SizeOf(us));
    try {
      Marshal.StructureToPtr(us,usp,false);
      var oa=new OBJECT_ATTRIBUTES { Length=Marshal.SizeOf(typeof(OBJECT_ATTRIBUTES)),RootDirectory=parent.DangerousGetHandle(),ObjectName=usp,Attributes=0x40 };
      SafeFileHandle h;IO_STATUS_BLOCK io;
      // SYNCHRONIZE + READ_DATA/LIST_DIRECTORY + READ_ATTRIBUTES; add WRITE_DATA
      // only for final existing files. Parents share reads only; final file none.
      int status=NtCreateFile(out h,0x100081u|(write?2u:0u),ref oa,out io,IntPtr.Zero,0,dir?1u:0u,1,0x200000u|0x20u|(dir?1u:0x40u),IntPtr.Zero,0);
      if(status<0){if(h!=null)h.Dispose();throw new Exception("OPEN_DENIED_"+status.ToString("X8"));}
      try{Info(h,dir);return h;}catch{h.Dispose();throw;}
    }finally{Marshal.FreeHGlobal(usp);Marshal.FreeHGlobal(text);}
  }
  static void Abort() { if(File!=null){File.Dispose();File=null;}Ticket=null;while(Parents.Count>RootCount){int n=Parents.Count-1;Parents[n].Dispose();Parents.RemoveAt(n);} }
  static int RootCount;
  static byte[] Bytes() {if(File.Length>Maximum)throw new Exception("TEXT_LIMIT");File.Position=0;var b=new byte[(int)File.Length];int n=0,r;while(n<b.Length&&(r=File.Read(b,n,b.Length-n))>0)n+=r;if(n!=b.Length)throw new Exception("READ_INCOMPLETE");var text=Utf8.GetString(b);if(text.IndexOf('\0')>=0)throw new Exception("TEXT_BINARY");return b;}
  static string Str(Dictionary<string,object> x,string k) {if(!x.ContainsKey(k)||!(x[k] is string))throw new Exception("INVALID_REQUEST");return (string)x[k];}
  static void Shape(Dictionary<string,object> x,params string[] keys) {if(x.Count!=keys.Length)throw new Exception("INVALID_REQUEST");foreach(var k in keys)if(!x.ContainsKey(k))throw new Exception("INVALID_REQUEST");}
  static object Dispatch(Dictionary<string,object> x) {
    string op=Str(x,"op");
    if(op=="abort"){Shape(x,"op");Abort();return new { aborted=true };}
    if(op=="prepare") {
      Shape(x,"op","path","write","maxBytes");if(File!=null)throw new Exception("BUSY");
      var p=Str(x,"path");if(p.Length>512||p.StartsWith("/")||p.IndexOf('\\')>=0||p.IndexOf(':')>=0)throw new Exception("PATH_DENIED");
      Maximum=Convert.ToInt32(x["maxBytes"]);if(Maximum<1||Maximum>65536||!(x["write"] is bool))throw new Exception("INVALID_REQUEST");
      var parts=p.Split('/');SafeFileHandle parent=Parents[RootCount-1];
      for(int i=0;i<parts.Length-1;i++){parent=Relative(parent,parts[i],true,false);Parents.Add(parent);}
      var file=Relative(parent,parts[parts.Length-1],false,(bool)x["write"]);var info=Info(file,false);
      try{File=new FileStream(file,(bool)x["write"]?FileAccess.ReadWrite:FileAccess.Read);}catch{file.Dispose();throw;}
      var b=Bytes();Ticket=Guid.NewGuid().ToString("N");
      return new { ticket=Ticket, text=Utf8.GetString(b),revision=Hash(b), fileId=info.Volume.ToString("X8")+":"+info.IndexHigh.ToString("X8")+info.IndexLow.ToString("X8") };
    }
    if(op=="commit") {
      Shape(x,"op","ticket","expectedRevision","text");if(File==null||Ticket!=Str(x,"ticket"))throw new Exception("TICKET_DENIED");
      if(Hash(Bytes())!=Str(x,"expectedRevision"))throw new Exception("REVISION_CHANGED");
      var b=Utf8.GetBytes(Str(x,"text"));if(b.Length>Maximum||Str(x,"text").IndexOf('\0')>=0)throw new Exception("TEXT_LIMIT");
      File.Position=0;File.Write(b,0,b.Length);File.SetLength(b.Length);File.Flush(true);
      var result=new {revision=Hash(b),bytes=b.Length};Abort();return result;
    }
    throw new Exception("OP_DENIED");
  }
  static int Main(string[] args) {
    try {
      if(args.Length!=1)throw new Exception("ROOT_REQUIRED");var full=Path.GetFullPath(args[0]);var root=Path.GetPathRoot(full);
      if(root.Length!=3||root[1]!=':'||GetDriveType(root)!=3)throw new Exception("LOCAL_FIXED_VOLUME_REQUIRED");
      uint serial,max,flags;var fs=new StringBuilder(100);if(!GetVolumeInformation(root,null,0,out serial,out max,out flags,fs,100)||fs.ToString()!="NTFS")throw new Exception("NTFS_REQUIRED");
      var h=CreateFile("\\\\?\\"+root,0x100081,1,IntPtr.Zero,3,0x2200000,IntPtr.Zero);if(h.IsInvalid)throw new Exception("ROOT_OPEN_DENIED");Info(h,true);Parents.Add(h);
      foreach(var p in full.Substring(root.Length).TrimEnd('\\').Split(new char[]{'\\'},StringSplitOptions.RemoveEmptyEntries)){h=Relative(h,p,true,false);Parents.Add(h);}
      RootCount=Parents.Count;Console.WriteLine(Json.Serialize(new {ready=true, protocol=1}));
      string line;while((line=Console.ReadLine())!=null){try{if(line.Length>290000)throw new Exception("REQUEST_LIMIT");var req=Json.Deserialize<Dictionary<string,object>>(line);Console.WriteLine(Json.Serialize(new {ok=true,result=Dispatch(req)}));}catch(Exception e){Abort();Console.WriteLine(Json.Serialize(new {ok=false,error=e.Message.StartsWith("OPEN_DENIED_")?"OPEN_DENIED":e.Message}));}}
      return 0;
    }catch{Console.WriteLine("{\"ready\":false,\"error\":\"ROOT_UNSAFE\"}");return 1;}
    finally{Abort();foreach(var p in Parents)p.Dispose();}
  }
}
