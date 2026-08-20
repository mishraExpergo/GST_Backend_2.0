$word = New-Object -ComObject Word.Application
$word.Visible = $false
$doc = $word.Documents.Open("c:\Users\USER\GST_Backend_2.0\backend\charts logic (1).docx")
$text = $doc.Content.Text
$text | Out-File -FilePath "c:\Users\USER\GST_Backend_2.0\backend\charts_logic_extracted.txt" -Encoding UTF8
$doc.Close()
$word.Quit()
Write-Host "Extraction complete"
