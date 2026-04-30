import json
import re
from urllib.parse import urlparse
import requests
import base64
import os

database_server_url = os.environ.get("STORE_MANAGER_URL", os.environ.get("DATABASE_SERVER_URL", "http://localhost:3000"))

# Made update - test
class config( dict ):

    def __init__( self, path = "config.txt", *args, **kw):

        super( config, self ).__init__( *args, **kw)

        # The 'r' before the string is important for Windows paths.
        self['STATIC_IMAGE_BASE_PATH'] = r"./static_images"

        # Open the file

        #self['proxies'] = { 'http': 'http://135.245.48.34:8000',
        #                    'https': 'https://135.245.48.34:8000'
        #                  }

        self['proxies'] = {}

        self['google_api_key'] = 'AIzaSyDwbSCuiHBsLBfd-NLYokwn7dflYj_IdN8'

        self[ 'ssactivewear_api' ] = {
                            'username': "419064",
                            'secret': "5d3c7898-b3e3-4776-80af-786fd2c9af47",
                            'url' : 'https://api.ssactivewear.com/v2'
                        }
        
        # GraphQL Catalog Server Configuration
        self['catalog_graphql_url'] = os.environ.get('CATALOG_GRAPHQL_URL', 'https://catalog.mlswebstores.com/api/graphql')
        #self['catalog_graphql_url'] = os.environ.get('CATALOG_GRAPHQL_URL', 'http://localhost:8913/api/graphql')
        self['catalog_username'] = os.environ.get('CATALOG_USERNAME', 'admin@example.com')
        self['catalog_password'] = os.environ.get('CATALOG_PASSWORD', 'admin123')
        # Alternative: use bearer token instead of username/password
        self['catalog_auth_token'] = os.environ.get('CATALOG_AUTH_TOKEN', None)
        
        # Date code is YYMMDD
        self['version'] = "0.49999.200824"

        # Fetch the data from the server and then munge it back together
        api_token = os.environ.get("API_TOKEN", "")
        auth_headers = {"Authorization": f"Bearer {api_token}"} if api_token else {}

        data = requests.get( database_server_url + '/api/orderdesk' , timeout = 5, headers=auth_headers ).json()
        self.orderDeskMapping = [ { "id"    : d['orderDeskId'],
                                    "name"  : d['name'],
                                    "sku"   : d['sku'],
                                    "apiKey" : d['apiKey'],
                                    "shipStationId" : d['shipStationId']} for d in data]


        data = requests.get( database_server_url + '/api/sites', timeout=5, headers=auth_headers ).json()
        self.sites = [ {
                        "id" : site['slug'],
                        "sku" : site['sku'],
                        "name" : site['name'],
                        "domain" : site['domain'],
                        "url" : site['url'],
                        "key" : site['key'],
                        "secret" : site['secret'],
                        "app_user" : site['app_user'],
                        "app_pass" : site['app_pass'] } for site in data ]

    def getStoreKeyByStoreNumber( self, number, host = "mlswebstores.com" ):

      # Make a call to the website to get the

      c = self.getStoreKeyByDomain( host )

      token = base64.b64encode( (c['app_user']+":"+c['app_pass']).encode())
      headers = {'Authorization': 'Basic ' + token.decode('utf-8')}

      res = requests.get( "https://mlswebstores.com/wp-json/mls/v1/site/{}".format( number ), headers=headers )

      if( res.status_code == 200 ):

        return self.getStoreKeyByDomain( res.json()[0]['domain'])
      else:
        return
      None

    def getStoreKeyById( self, id ):
      return next(filter((lambda x: x['id'] == id ), self.sites), {} )

    def getStoreKeyByDomain( self, domain ):
      return next( filter((lambda x: x['domain'] == domain ), self.sites), {} )

    def getStoreKeyByUrl( self, url ):
      for sitename, site in self['sites'].items():

        # Get the domain from the url
        if urlparse(url).hostname == urlparse(site['url']).hostname:
          return sitename, urlparse( site['url']).hostname

      return None