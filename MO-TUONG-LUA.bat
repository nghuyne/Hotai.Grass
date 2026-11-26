@echo off
chcp 65001 >nul
title Mo tuong lua cho Web HoHai VN
rem Cho phep may khac trong MANG NOI BO (Private) vao cong 8080 cua may nay. Chi can chay 1 lan.
rem 仅允许局域网（专用网络）中的其他电脑访问本机 8080 端口。只需运行一次。
set PORT=8080

net session >nul 2>&1
if errorlevel 1 (
  echo Can quyen quan tri, dang xin quyen... / 需要管理员权限，正在请求...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

netsh advfirewall firewall delete rule name="HoHai Web VN %PORT%" >nul 2>&1
netsh advfirewall firewall add rule name="HoHai Web VN %PORT%" dir=in action=allow protocol=TCP localport=%PORT% profile=private,domain
if errorlevel 1 (
  echo.
  echo   Khong them duoc quy tac tuong lua. / 防火墙规则添加失败。
) else (
  echo.
  echo   Da mo cong %PORT% cho mang noi bo. / 已为局域网开放 %PORT% 端口。
  echo   Neu van khong vao duoc: kiem tra mang Wi-Fi dang de "Private" chu khong phai "Public".
  echo   如果仍无法访问：请确认 Wi-Fi 网络类型为“专用(Private)”而不是“公用(Public)”。
)
echo.
echo   Go bo sau nay / 以后删除:  netsh advfirewall firewall delete rule name="HoHai Web VN %PORT%"
echo.
pause
