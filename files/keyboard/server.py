from http.server import HTTPServer, SimpleHTTPRequestHandler
import os
from urllib.parse import unquote

class ForceDownloadHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        path = self.translate_path(self.path)
        path = unquote(path)

        if os.path.isdir(path):
            return super().send_head()

        if os.path.isfile(path):
            f = open(path, 'rb')
            self.send_response(200)
            self.send_header("Content-type", "application/octet-stream")
            self.send_header("Content-Disposition", f"attachment; filename={os.path.basename(path)}")
            fs = os.fstat(f.fileno())
            self.send_header("Content-Length", str(fs.st_size))
            self.end_headers()
            return f

        self.send_error(404, "File not found")
        return None

if __name__ == '__main__':
    PORT = 8000
    server = HTTPServer(('localhost', PORT), ForceDownloadHandler)
    print(f"Serving with forced download on http://localhost:{PORT}/")
    server.serve_forever()
