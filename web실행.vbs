' md2pdf web viewer launcher (no console window)
'  - Double-click: starts the server in the background and opens the browser
'  - If the server is already running, it just opens the browser
'  - Stop the server: double-click the stop .bat (web-stop)
'  - Server output/errors: web.log
'  - Other port: set the PORT environment variable (default 3000)
Option Explicit

Dim sh, fso, dir, port, url, i
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir

port = sh.ExpandEnvironmentStrings("%PORT%")
If port = "%PORT%" Or port = "" Then port = "3000"
url = "http://localhost:" & port

Function ServerUp()
  Dim http
  ServerUp = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.ServerXMLHTTP")
  http.setTimeouts 500, 500, 500, 500
  http.open "GET", url & "/", False
  http.send
  If Err.Number = 0 Then ServerUp = True
  On Error GoTo 0
End Function

If Not ServerUp() Then
  ' Node.js available?
  If sh.Run("cmd /c where node >nul 2>nul", 0, True) <> 0 Then
    MsgBox "Node.js is not installed or not in PATH.", vbCritical, "md2pdf web viewer"
    WScript.Quit 1
  End If

  ' First run: install packages (visible so progress/errors can be seen)
  If Not fso.FolderExists(dir & "\node_modules") Then
    If sh.Run("cmd /c echo Installing packages for the first run... & npm install", 1, True) <> 0 Then
      MsgBox "npm install failed.", vbCritical, "md2pdf web viewer"
      WScript.Quit 1
    End If
  End If

  ' Start the server hidden, output goes to web.log
  sh.Run "cmd /c set PORT=" & port & "&& node src\server.js > web.log 2>&1", 0, False

  ' Wait up to ~15s for the server to respond
  For i = 1 To 30
    If ServerUp() Then Exit For
    WScript.Sleep 500
  Next

  If Not ServerUp() Then
    MsgBox "Server did not start. See web.log for details.", vbExclamation, "md2pdf web viewer"
    WScript.Quit 1
  End If
End If

sh.Run url
